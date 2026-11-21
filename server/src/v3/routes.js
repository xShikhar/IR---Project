import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createWorkspace } from './workspace.js';
import { createSearchService } from './search.js';
import { executeConversationalTurn } from '../api/traceAssembly.js';
import { ContextState } from '../conversation/contextState.js';
import { CONFIG } from '../config/index.js';
import { scoreRanking } from '../../../eval/src/v3Metrics.js';

const domains=new Set(['cs_ai','space_physics','history_civilization','biology_medicine']);
const models=new Set(['hybrid','bm25','cosine','semantic']);
const contextVariants=['without-topic','without-history','without-feedback'];

function loadBenchmarks() {
  const files=[CONFIG.paths.conversationsFile,CONFIG.paths.splitsFile,CONFIG.paths.qrelsFile];
  if(!files.every(file=>fs.existsSync(file))) return new Map();
  const [dialogs,splits,judgments]=files.map(file=>JSON.parse(fs.readFileSync(file,'utf8')));
  const testIds=new Set(splits.test.conversationIds);
  const turns=new Map();
  for(const dialog of dialogs.filter(item=>testIds.has(item.id))) {
    const history=[];
    for(const turn of dialog.turns) {
      const id=`${dialog.id}_${turn.turnId}`;
      if(Object.hasOwn(judgments,id)) {
        turns.set(id,{id,topic:dialog.topic,query:turn.query,history:[...history],grades:judgments[id]});
      }
      history.push(turn.query);
    }
  }
  return turns;
}

export function createV3Router(index) {
  const router=express.Router();
  const search=index?createSearchService(index):null;
  const benchmarks=loadBenchmarks();
  const sessions=new Map();
  const error=(message,status=400)=>Object.assign(new Error(message),{status});
  function entry(req) {
    if(!index)throw error('The frozen corpus index is not loaded. Run npm run build:index.',503);
    const id=req.body&&Object.hasOwn(req.body,'sessionId')?req.body.sessionId:Object.hasOwn(req.query,'sessionId')?req.query.sessionId:'default';
    if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw error('Invalid sessionId. Use up to 128 letters, digits, underscores or hyphens.');
    const now=Date.now();
    for(const [key,value] of sessions)if(now-value.touched>6*60*60*1000)sessions.delete(key);
    if(!sessions.has(id)) {
      if(sessions.size>=200)throw error('Too many active sessions. Please reset an existing session.',429);
      sessions.set(id,{workspace:createWorkspace(index,search,{id}),touched:now,pending:Promise.resolve()});
    }
    const value=sessions.get(id);value.touched=now;return value;
  }
  function options(body={}) {
    if(body.model!==undefined&&!models.has(body.model))throw error('Unknown retrieval model.');
    if(body.domain&&!domains.has(body.domain))throw error('Unknown domain filter.');
    if(body.diversity!==undefined&&typeof body.diversity!=='boolean')throw error('diversity must be a boolean.');
    if(body.rerank!==undefined&&!['off','fixed','adaptive'].includes(body.rerank))throw error('Unknown reranking policy.');
    if(body.topicLock!==undefined&&!['soft','hard'].includes(body.topicLock))throw error('Unknown topic lock mode.');
    if(body.questionOnly!==undefined&&typeof body.questionOnly!=='boolean')throw error('questionOnly must be a boolean.');
    if(body.contextVariant!==undefined&&!contextVariants.includes(body.contextVariant))throw error('Unknown context variant.');
    const focusField=(value,maxLength,label)=>{
      if(typeof value!=='string'||!value.trim()||value.length>maxLength)throw error(`${label} must contain 1 to ${maxLength} characters.`);
      return value.trim();
    };
    const senseQuery=body.senseQuery===undefined?undefined:focusField(body.senseQuery,120,'Term to explore');
    let customSense;
    if(body.customSense!==undefined) {
      if(!senseQuery||!body.customSense||typeof body.customSense!=='object'||Array.isArray(body.customSense))throw error('A custom focus requires an explored term.');
      customSense={title:focusField(body.customSense.title,90,'Focus label'),keywords:focusField(body.customSense.keywords,160,'Focus keywords')};
    }
    if(body.newTopic!==undefined&&typeof body.newTopic!=='boolean')throw error('newTopic must be a boolean.');
    if(body.excludedTerms!==undefined&&(!Array.isArray(body.excludedTerms)||body.excludedTerms.length>80||body.excludedTerms.some(t=>typeof t!=='string'||t.length>100)))throw error('excludedTerms must be an array of up to 80 short strings.');
    for(const key of ['topicId','interpretationId','turnId'])if(body[key]!==undefined&&(typeof body[key]!=='string'||body[key].length>250))throw error(`Invalid ${key}.`);
    return {model:body.model||'hybrid',diversity:body.diversity===true,rerank:body.rerank??'off',topicLock:body.topicLock??'soft',domain:body.domain||null,topK:10,topicId:body.topicId,interpretationId:body.interpretationId,newTopic:body.newTopic,excludedTerms:body.excludedTerms||[],turnId:body.turnId,questionOnly:body.questionOnly===true,senseQuery,customSense,contextVariant:body.contextVariant};
  }
  const query=value=>{if(typeof value!=='string'||!value.trim()||value.length>2000)throw error('query must contain 1 to 2,000 characters.');return value.trim();};
  function route(method,url,handler) {
    router[method](url,(req,res)=>{
      let current;try{current=entry(req);}catch(e){res.status(e.status||400).json({error:e.message});return;}
      const work=current.pending.catch(()=>{}).then(()=>handler(req,res,current.workspace));
      current.pending=work.catch(()=>{});
      work.catch(e=>{console.error(`[TurnTrace v3] ${url}:`,e.message);if(!res.headersSent)res.status(e.status||400).json({error:e.message});});
    });
  }
  route('get','/session',(_req,res,w)=>res.json(w.snapshot()));
  route('delete','/session',(_req,res,w)=>{const state=w.reset();sessions.delete(state.id);res.json(state);});
  route('post','/search',async(req,res,w)=>res.json(await w.turn(query(req.body.query),options(req.body))));
  route('post','/preview',async(req,res,w)=>{
    const state=w.snapshot();
    const turn=req.body.turnId?state.turns.find(t=>t.id===req.body.turnId):req.body.query?state.turns.findLast(t=>t.query===req.body.query&&(!req.body.topicId||t.topicId===req.body.topicId)):state.turns.at(-1);
    const inherited={...turn?.options};
    if(!req.body.turnId)delete inherited.newTopic;
    res.json(await w.turn(query(req.body.query||turn?.query),{...options({...inherited,...req.body}),preview:true}));
  });
  route('post','/methods',async(req,res,w)=>{
    const turn=w.snapshot().turns.find(item=>item.id===req.body.turnId);
    if(!turn)throw error('Select a saved question to compare methods.');
    const settings=options({...turn.options,...req.body,diversity:false,rerank:'off'});
    const comparisons=[];
    for (const model of ['bm25','cosine','semantic','hybrid']) {
      if (model==='semantic' && !search.status().semantic.available) {
        comparisons.push({model,available:false,reason:search.status().semantic.reason});
        continue;
      }
      const run=await w.turn(turn.query,{...settings,model,preview:true,turnId:turn.id});
      comparisons.push({
        model,available:!run.clarification&&(model!=='semantic'||run.trace.semantic?.available),
        reason:run.clarification?.question??(model==='semantic'?run.trace.semantic?.reason:undefined),
        effectiveModel:run.trace.effectiveModel, elapsedMs:run.trace.timings?.totalMs,
        results:run.results.slice(0,5).map(({docId,title})=>({docId,title})),
      });
    }
    res.json({turnId:turn.id,comparisons});
  });
  route('post','/context-audit',async(req,res,w)=>{
    const turn=w.snapshot().turns.find(item=>item.id===req.body.turnId);
    if(!turn)throw error('Select a saved question to compare its context.');
    const replay=async contextVariant=>{
      const run=await w.turn(turn.query,{...options(turn.options),turnId:turn.id,preview:true,contextVariant});
      return {
        results:run.results.slice(0,5).map(({docId,title,snippet})=>({docId,title,snippet})),
        total:run.results.length, scope:run.trace.subjectLock?.effective,
      };
    };
    const baseline=await replay();
    const variants=[];
    for(const id of contextVariants) variants.push({id,...await replay(id)});
    res.json({turnId:turn.id,baseline,variants});
  });
  route('post','/topic',(req,res,w)=>res.json(w.selectTopic(req.body.topicId)));
  route('post','/feedback',(req,res,w)=>res.json(w.feedback(req.body.docId,req.body.action,req.body.topicId)));
  route('post','/undo',(_req,res,w)=>res.json(w.undo()));
  route('get','/comparison-benchmarks',(_req,res)=>res.json(
    [...benchmarks.values()].map(({id,topic,query,history})=>({id,topic,query,earlierTurns:history.length}))
  ));
  route('post','/compare',async(req,res,w)=>{
    const state=w.snapshot();
    if(req.body.benchmarkId!==undefined) {
      const benchmark=benchmarks.get(req.body.benchmarkId);
      if(!benchmark)throw error('Unknown benchmark question.',404);
      const policy=req.body.benchmarkRerank??'off';
      if(!['off','fixed','adaptive'].includes(policy))throw error('Unknown benchmark reranking policy.');
      const baselineState=new ContextState({mode:'v2'});
      const replay=createWorkspace(index,search);
      const settings={model:'hybrid',topK:10,diversity:false};
      for(const utterance of benchmark.history) {
        await executeConversationalTurn(utterance,baselineState,index,{topK:10});
        await replay.turn(utterance,settings);
      }
      const baseline=await executeConversationalTurn(benchmark.query,baselineState,index,{topK:10});
      const final=await replay.turn(benchmark.query,{...settings,rerank:policy,preview:true});
      const grades=Object.fromEntries([...baseline.results,...final.results]
        .filter(item=>Object.hasOwn(benchmark.grades,item.docId))
        .map(item=>[item.docId,benchmark.grades[item.docId]]));
      return res.json({query:benchmark.query,baseline,final,session:state,
        replay:{benchmarkId:benchmark.id,priorTurnCount:benchmark.history.length,rerank:policy},
        relevance:{source:'Inherited AI relevance judgments · TEST split',grades,
          baseline:scoreRanking(baseline.results,benchmark.grades),final:scoreRanking(final.results,benchmark.grades)},
      });
    }
    const suppliedQuery=req.body.query===undefined?undefined:query(req.body.query);
    const selectedIndex=req.body.turnId
      ? state.turns.findIndex(turn=>turn.id===req.body.turnId)
      : req.body.subjects ? -1
        : suppliedQuery===undefined ? state.turns.length-1
          : state.turns.findLastIndex(turn=>turn.query===suppliedQuery);
    if(req.body.turnId&&selectedIndex<0)throw error('Unknown turn.');
    const selected=state.turns[selectedIndex];
    const q=suppliedQuery??query(req.body.subjects?'overview':selected?.query);
    const opts=options({...selected?.options,...req.body});
    const midterm=req.body.midterm;
    const baselineSettings={topK:10,applySeenPenalty:true};
    if(midterm!==undefined) {
      if(!midterm||typeof midterm!=='object'||Array.isArray(midterm))throw error('Invalid midterm settings.');
      if(!['bm25','cosine'].includes(midterm.model))throw error('Unknown midterm model.');
      if(!['hard','soft'].includes(midterm.lockMode))throw error('Unknown midterm lock mode.');
      Object.assign(baselineSettings,{model:midterm.model,lockMode:midterm.lockMode});
      for(const key of ['useChampionLists','applyIndexElimination','applySeenPenalty']) {
        if(typeof midterm[key]!=='boolean')throw error(`Invalid midterm value for ${key}.`);
        baselineSettings[key]=midterm[key];
      }
    }
    const ctx=new ContextState();
    const history=selected?state.turns.slice(0,selectedIndex):state.turns;
    for(const turn of history)await executeConversationalTurn(turn.query,ctx,index,baselineSettings);
    const baseline=await executeConversationalTurn(q,ctx,index,baselineSettings);
    const final=await w.turn(q,{...opts,preview:true,turnId:selected?.id});
    const ranks=new Map(baseline.results.map((r,i)=>[r.docId,i+1]));
    const rankChanges=final.results.map((r,i)=>({docId:r.docId,title:r.title,baselineRank:ranks.get(r.docId)||null,finalRank:i+1,delta:ranks.has(r.docId)?ranks.get(r.docId)-(i+1):null}));
    let subjects;
    if(req.body.subjects!==undefined) {
      if(!Array.isArray(req.body.subjects)||req.body.subjects.length!==2)throw error('Provide exactly two subjects.');
      subjects=await Promise.all(req.body.subjects.map(async subject=>{
        subject=query(subject);const r=await search.search(`${subject} ${q}`,{...opts,topic:{title:subject,entityTerms:[]},feedback:{relevant:[],irrelevant:[],pinned:[]}});
        return {subject,...r};
      }));
    }
    res.json({query:q,baseline,final,rankChanges,subjects,session:w.snapshot(),
      replay:{turnId:selected?.id??null,priorTurnCount:history.length}});
  });
  route('get','/scenarios',(_req,res)=>{
    const file=path.join(CONFIG.paths.dataDir,'v3_scenarios.json');
    if(fs.existsSync(file)) {const payload=JSON.parse(fs.readFileSync(file,'utf8'));res.json(Array.isArray(payload)?payload:payload.scenarios||[]);}
    else res.json([{id:'return-to-topic',title:'Switch topics. Keep your place.',description:'Explore JWST, visit CRISPR, and return to the telescope.',turns:['What is the James Webb Space Telescope?','Where is its orbit located?','Explain CRISPR gene editing.','What are its limitations?','Back to JWST, what instruments does it carry?']},{id:'mercury',title:'One word. Different worlds.',description:'Resolve an ambiguous subject and follow its meaning.',turns:['Tell me about Mercury','How does it affect the nervous system?']}]);
  });
  route('get','/evaluation',(_req,res)=>{
    const base=path.join(CONFIG.paths.evalOutputDir,'v3');
    const semantic=fs.existsSync(path.join(base,'semantic','summary.json'));
    const file=path.join(base,semantic?'semantic':'','summary.json');
    const readSummary = folder => {
      const summary = path.join(base, folder, 'summary.json');
      return fs.existsSync(summary) ? JSON.parse(fs.readFileSync(summary, 'utf8')) : null;
    };
    res.json(fs.existsSync(file)?{available:true,reportVariant:semantic?'semantic':'lexical',...JSON.parse(fs.readFileSync(file,'utf8')),
      ablation:readSummary('ablation'),review:readSummary('review')
    }:{available:false,summary:'Run npm run eval:v3 to generate measured results. No metrics have been fabricated.'});
  });
  route('get','/evaluation/ablation/:artifact',(req,res)=>{
    if(!['summary.json','per_turn.csv','unjudged_pool.csv'].includes(req.params.artifact))throw error('Unknown evaluation artifact.',404);
    const file=path.join(CONFIG.paths.evalOutputDir,'v3','ablation',req.params.artifact);
    if(!fs.existsSync(file))throw error('Run npm run eval:v3 -- --ablation first.',404);
    res.download(file);
  });
  route('get','/evaluation/review/pool.csv',(_req,res)=>{
    const file=path.join(CONFIG.paths.evalOutputDir,'v3','review','pool.csv');
    if(!fs.existsSync(file))throw error('Run npm run eval:review first.',404);
    res.download(file);
  });
  route('get','/evaluation/:artifact',(req,res)=>{
    if(!['summary.json','per_turn.csv','unjudged_pool.csv'].includes(req.params.artifact))throw error('Unknown evaluation artifact.',404);
    const base=path.join(CONFIG.paths.evalOutputDir,'v3');
    const directory=fs.existsSync(path.join(base,'semantic','summary.json'))?path.join(base,'semantic'):base;
    const file=path.join(directory,req.params.artifact);
    if(!fs.existsSync(file))throw error('Run npm run eval:v3 first.',404);
    res.download(file);
  });
  route('get','/export',(_req,res,w)=>{
    res.setHeader('Content-Disposition','attachment; filename="turntrace-session.json"');
    res.json({application:'TurnTrace 2',exportedAt:new Date().toISOString(),session:w.snapshot(),retrieval:search.status(),provenance:{repository:'https://github.com/xShikhar/IR---MidTerm-Assignment',commit:'d0022603ebd9181f21e0e406cfd4a2d72af79104'}});
  });
  return {router,status:()=>search?.status()||{available:false,reason:'Index not loaded.'}};
}
