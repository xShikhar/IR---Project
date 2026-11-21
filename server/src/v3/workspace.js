import { analyze } from '../index/normalizer.js';

const copy = value => structuredClone(value);
const canonical = title => (title || '').replace(/\s+-\s+Section\s+\d+.*$/i, '').trim();
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const generic = new Set(analyze('tell explain know describe information about please back return topic new more give overview mean meaning definition',true));
const terms = value => [...new Set(analyze(value, true))].filter(t => !generic.has(t));
const elaboration = /^(?:(?:please|can you|could you)\s+)*(?:why|how so|(?:tell me|explain|elaborate|expand|say|give me) (?:more|further)|elaborate|expand on that|what (?:does|did) (?:that|this) mean)[?.!\s]*$/i;

/** A session owns its topic memory. Retrieval and previews receive detached copies. */
export function createWorkspace(index, searchService, options = {}) {
  const catalog = [...new Set(Object.values(index.docs).map(d => canonical(d.title)))];
  const titleFrequency = new Map();
  const entries = catalog.map(title => {
    const tokens=terms(title);
    for (const token of tokens) titleFrequency.set(token,(titleFrequency.get(token)||0)+1);
    const acronym = title.replace(/\([^)]*\)/g,'').split(/\s+/).filter(w => /^[A-Z]/.test(w)).map(w=>w[0]).join('').toLowerCase();
    return {title,tokens,base:title.replace(/\s*\([^)]*\)/g,'').trim(),acronym};
  });
  const initial = () => ({id:options.id || 'workspace',activeTopicId:null,topics:[],turns:[],nextTopic:1});
  let data=initial();
  const undoStack=[];
  const beforeTurns=new Map();
  const remember=()=>{undoStack.push(copy(data));if(undoStack.length>80)undoStack.shift();};
  const snapshot=()=>({...copy(data),canUndo:undoStack.length>0});

  function mentions(query) {
    const normalized=normalize(query), tokens=terms(query), tokenSet=new Set(tokens);
    return entries.map(entry=>{
      const full=normalize(entry.title),base=normalize(entry.base);
      const phrase=full.length>2 && (` ${normalized} `).includes(` ${full} `);
      const baseMatch=base.length>2 && (` ${normalized} `).includes(` ${base} `);
      const acronym=entry.acronym.length>=3 && (` ${normalized} `).includes(` ${entry.acronym} `);
      const matched=entry.tokens.filter(t=>tokenSet.has(t));
      const rare=matched.some(t=>(titleFrequency.get(t)||0)<=2 && t.length>=4);
      let score=phrase ? 20+entry.tokens.length : acronym ? 19 : baseMatch ? 12 : 0;
      if(!score && rare) score=6+matched.length/Math.max(1,entry.tokens.length);
      if(!score && matched.length>=2 && matched.length/entry.tokens.length>=0.7) score=4+matched.length;
      return {...entry,score,matched};
    }).filter(e=>e.score>0).sort((a,b)=>b.score-a.score || a.title.length-b.title.length);
  }

  function interpretationChoices(query) {
    const candidates=searchService.interpretations(query) || [];
    const queryTerms=terms(query);
    // Clarify a bare ambiguous subject, not every pair of similarly ranked passages.
    const groups=new Map();
    for(const option of candidates) {
      const base=option.title.replace(/\s*\([^)]*\)/g,'').trim().toLowerCase();
      if(!(` ${normalize(query)} `).includes(` ${normalize(base)} `))continue;
      if(!groups.has(base))groups.set(base,[]);
      groups.get(base).push(option);
    }
    for(const [base,choices] of groups) {
      if(choices.length<2)continue;
      const baseTerms=new Set(terms(base));
      const additional=queryTerms.filter(t=>!baseTerms.has(t));
      if(additional.length===0)return choices.slice(0,5);
    }
    return [];
  }

  async function execute(query, opts={}, state) {
    if(typeof query!=='string'||!query.trim()) throw new Error('A non-empty query is required.');
    query=query.trim();
    const started=performance.now();
    if (opts.questionOnly) {
      if (!opts.preview) throw new Error('Question-only search is available in a ranking preview.');
      const result = await searchService.search(query, { ...opts, topic: undefined, feedback: {}, history: [] });
      return {
        ...result, clarification: null,
        trace: {
          ...result.trace, questionOnly: true,
          decision: { action: 'RAW_QUERY', reason: 'Used only the words in this question.' },
          timings: { ...result.trace?.timings, totalMs: Number((performance.now() - started).toFixed(2)) },
        },
      };
    }
    if (opts.contextVariant && !opts.preview) throw new Error('Context variants are only available in previews.');
    const candidates=mentions(query);
    const active=state.topics.find(t=>t.id===state.activeTopicId);
    const discovery = opts.senseQuery ? (searchService.discoverInterpretations?.(opts.senseQuery) ?? []) : null;
    const choices=discovery ?? interpretationChoices(query);
    let selected=null,topic=null,action='CONTINUE',reason='Continued the active topic using its selected subject.';
    if(opts.topicId) {
      topic=state.topics.find(t=>t.id===opts.topicId);
      if(!topic)throw new Error('Unknown topic.');
      action=topic.id===state.activeTopicId?'CONTINUE':'RESUME';
      reason='Used the topic explicitly selected by the user.';
    }
    if (discovery && !opts.interpretationId && !opts.customSense) {
      return {
        results: [], trace: { decision: { action: 'CLARIFY', reason: 'The user asked to explore a term in the corpus.' } },
        session: snapshot(),
        clarification: { question: `Explore “${opts.senseQuery}”`, options: discovery, allowAll: true, senseQuery: opts.senseQuery },
      };
    }
    if (opts.customSense) {
      const keywords = terms(opts.customSense.keywords).filter(term => Object.hasOwn(index.dictionary, term));
      if (!keywords.length) throw new Error('Choose focus keywords that appear in the corpus.');
      const title = opts.customSense.title;
      const id = `custom:${normalize(opts.senseQuery)}:${normalize(title)}:${keywords.join('-')}`;
      selected = { id, title, terms: keywords };
      topic = opts.newTopic ? null : state.topics.findLast(entry => entry.interpretationId === id);
      action = topic ? (topic.id === state.activeTopicId ? 'CONTINUE' : 'RESUME') : 'CREATE';
      reason = 'Used the focus label and corpus keywords supplied by the user.';
    } else if (opts.interpretationId === 'all-interpretations') {
      if (!discovery && choices.length < 2) throw new Error('This question has no competing interpretations.');
      const title = opts.senseQuery ?? choices[0].title.replace(/\s*\([^)]*\)\s*$/, '');
      selected = { title, terms: discovery ? [] : terms(title) };
      topic = opts.newTopic ? null : state.topics.findLast(entry => entry.title === title && !entry.interpretationId &&
        (!discovery || !entry.entityTerms.length));
      action = topic ? (topic.id === state.activeTopicId ? 'CONTINUE' : 'RESUME') : 'CREATE';
      reason = 'The user chose a broad search across the indexed interpretations.';
    } else if(opts.interpretationId?.startsWith('topic:')) {
      topic=state.topics.find(t=>`topic:${t.id}`===opts.interpretationId);
      if(!topic)throw new Error('Unknown topic interpretation.');
      action=topic.id===state.activeTopicId?'CONTINUE':'RESUME';
      reason='The user resolved which previous topic this query refers to.';
    } else if(opts.interpretationId) {
      selected=(discovery??searchService.interpretations(query)??[]).find(c=>c.id===opts.interpretationId);
      if(!selected)throw new Error('Unknown interpretation.');
      topic=opts.newTopic?null:active&&(active.interpretationId===selected.id||active.title===selected.title)?active:state.topics.findLast(t=>t.interpretationId===selected.id || t.title===selected.title);
      action=topic ? topic.id===state.activeTopicId?'CONTINUE':'RESUME' : 'CREATE';
      reason='The user selected an interpretation supported by indexed articles.';
    }
    if(!topic&&!selected&&!opts.newTopic&&active?.interpretationId&&choices.some(c=>c.id===active.interpretationId)) {
      topic=active;reason='Preserved the interpretation previously confirmed by the user.';
    }
    if(!topic&&!selected&&choices.length>1) {
      return {results:[],trace:{decision:{action:'CLARIFY',reason:'The subject has multiple indexed interpretations.'}},session:{...copy(state),canUndo:undoStack.length>0},clarification:{question:'Which interpretation do you mean?',options:choices,allowAll:true}};
    }
    if(!topic&&!selected&&!opts.newTopic&&active&&candidates.length===0&&state.topics.length>1&&/\b(it|its|they|their|them|this|that)\b/i.test(query)&&/\b(back|earlier|previous|first|other)\b/i.test(query)) {
      return {results:[],trace:{decision:{action:'CLARIFY',reason:'The reference could point to a previous topic.'}},session:{...copy(state),canUndo:undoStack.length>0},clarification:{question:'Which conversation topic should I use?',options:state.topics.map(t=>({id:`topic:${t.id}`,title:t.title,terms:t.entityTerms,docCount:0,example:`${t.turnCount} previous turns`}))}};
    }
    if(!topic&&!selected&&!opts.newTopic) {
      // An ordinary noun in an anaphoric/aspect question is not a subject switch.
      let best=candidates.find(candidate => {
        const followUp=/\b(it|its|they|their|them|he|she|there|this|that|these|those)\b/i.test(query)||/^(what|how) about\b/i.test(query);
        const switching=/\b(now|switch|instead|new topic)\b/i.test(query);
        const acronym=candidate.acronym.length>=3&&(` ${normalize(query)} `).includes(` ${candidate.acronym} `);
        const named=(candidate.title.match(/\b[A-Z]{2,}\b/g)||[]).some(name=>query.includes(name));
        const properPhrase=candidate.title.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g)?.some(name=>query.includes(name));
        const definition=/^(?:please\s+)?(?:what (?:is|are)|tell me about|explain|define|describe)\b/i.test(query);
        return !active || switching || candidate.title===active.title || acronym || named || properPhrase || (!followUp&&(candidate.score>=19 || definition&&candidate.score>=12));
      });
      const activeMention=candidates.find(c=>c.title===active?.title);
      if(best&&activeMention&&activeMention.score>=best.score)best=activeMention;
      if(best) {
        topic=active?.title===best.title?active:state.topics.findLast(t=>t.title===best.title);
        if(topic) {
          action=topic.id===state.activeTopicId?'CONTINUE':'RESUME';
          reason=action==='RESUME'?'Resumed an earlier topic referenced by this query.':'The query explicitly references the active subject.';
        } else if(!active || best.score>=6) {
          selected={title:best.title,terms:best.tokens}; action='CREATE';
          reason='The query introduces a distinct indexed subject.';
        }
      }
      if(!topic&&!selected&&active)topic=active;
    }
    if(!topic) {
      const best=selected || candidates[0];
      const label=best?.title || query.replace(/[?!.]+$/,'').slice(0,88);
      topic={id:`topic_${state.nextTopic++}`,title:label,entityTerms:best?.terms || best?.tokens || terms(label),interpretationId:best?.id || null,aspects:[],turnCount:0,feedback:{relevant:[],irrelevant:[],pinned:[]},createdAt:new Date().toISOString()};
      state.topics.push(topic);action='CREATE';
      reason=opts.newTopic?'Created a separate topic at the user\'s request.':reason;
    }
    state.activeTopicId=topic.id;
    if(selected?.id) {
      topic.interpretationId=selected.id;
      topic.entityTerms=selected.terms;
    }
    const excluded=new Set((opts.excludedTerms||[]).flatMap(terms));
    const subjectTerms=new Set(topic.entityTerms);
    const history = [];
    if (opts.useAspectHistory !== false && elaboration.test(query)) {
      const prior = state.turns.findLast(turn => turn.topicId === topic.id && turn.aspects?.length);
      if (prior) {
        for (const term of prior.aspects) {
          if (!subjectTerms.has(term) && !excluded.has(term)) history.push({ term, sourceTurn: prior.id });
          if (history.length === 4) break;
        }
      }
    }
    const previousAspects = topic.aspects;
    topic.aspects=terms(query).filter(t=>!subjectTerms.has(t)&&!excluded.has(t));
    const earlierTurns = state.turns.filter(turn => turn.topicId === topic.id);
    const seenDocIds = earlierTurns.flatMap(turn => turn.resultIds);
    const routingMs = Number((performance.now() - started).toFixed(2));
    const retainedTopic = opts.contextVariant === 'without-topic'
      ? undefined : copy(topic);
    const removed = { 'without-topic': 'topic terms and lock', 'without-history': 'earlier aspect terms', 'without-feedback': 'feedback and pins' }[opts.contextVariant];
    const retrieved=await searchService.search(query,{...opts,topic:retainedTopic,
      feedback:opts.contextVariant === 'without-feedback' ? {} : copy(topic.feedback),
      excludedTerms:[...excluded],history:opts.contextVariant === 'without-history' ? [] : history,seenDocIds});
    topic.turnCount++;
    const turn={id:`turn_${state.turns.length+1}`,query,topicId:topic.id,topicTitle:topic.title,decision:action,createdAt:new Date().toISOString(),resultIds:retrieved.results.map(r=>r.docId),options:{model:opts.model||'hybrid',diversity:opts.diversity!==false,domain:opts.domain||null,excludedTerms:[...excluded],newTopic:Boolean(opts.newTopic),...(opts.interpretationId?{interpretationId:opts.interpretationId}: {})}};
    if (opts.topicId) turn.options.topicId = opts.topicId;
    if (opts.senseQuery) turn.options.senseQuery = opts.senseQuery;
    if (opts.customSense) turn.options.customSense = opts.customSense;
    if (opts.rerank) turn.options.rerank = opts.rerank;
    if (opts.topicLock) turn.options.topicLock = opts.topicLock;
    turn.aspects = elaboration.test(query) ? [] : topic.aspects;
    state.turns.push(turn);
    const included=(retrieved.trace?.termWeights||[]).map(t=>({
      term:t.term,weight:t.weight,
      role:t.sources?.current?'query':t.sources?.history?'history':t.sources?.feedback?'feedback':'entity',
      ...(t.historyTurn ? {sourceTurn:t.historyTurn} : {})
    }));
    return {...retrieved,trace:{...retrieved.trace,architecture:'v3_branching_memory',
      ...(removed ? { contextRemoved: removed } : {}),
      decision:{action,reason,topicId:topic.id,topicTitle:topic.title,previousTopic:active?.title,candidates:candidates.slice(0,4).map(c=>({title:c.title,score:c.score}))},
      context:{included,excluded:[...excluded],subject:topic.title,aspects:topic.aspects,previousAspects,subjectTerms:topic.entityTerms,earlierTurns:earlierTurns.length,interpretationId:topic.interpretationId},
      timings:{ routing: routingMs,...retrieved.trace?.timings,totalMs:Number((performance.now()-started).toFixed(2)) }
    },session:{...copy(state),canUndo:true},clarification:null};
  }

  return {
    snapshot,
    async turn(query, opts={}) {
      if(opts.turnId&&!opts.preview)throw new Error('Historical turn IDs can only be used for a preview.');
      if(opts.turnId&&!data.turns.some(t=>t.id===opts.turnId))throw new Error('Unknown turn.');
      const base=opts.turnId&&beforeTurns.has(opts.turnId)?beforeTurns.get(opts.turnId):data;
      const next=copy(base);
      const original=data.turns.find(t=>t.id===opts.turnId);
      const effective={...original?.options,...opts};
      if(original&&effective.newTopic===undefined)effective.newTopic=original.options.newTopic;
      if(!effective.interpretationId&&original?.options.interpretationId)effective.interpretationId=original.options.interpretationId;
      if(!effective.senseQuery&&original?.options.senseQuery)effective.senseQuery=original.options.senseQuery;
      if(!effective.customSense&&original?.options.customSense)effective.customSense=original.options.customSense;
      if(effective.topicId&&!next.topics.some(t=>t.id===effective.topicId)&&original?.topicId===effective.topicId)delete effective.topicId;
      const response=await execute(query,effective,next);
      if(!opts.preview&&!response.clarification) {
        remember();beforeTurns.set(next.turns.at(-1).id,copy(data));data=next;
        response.session=snapshot();
      } else response.session=snapshot();
      return response;
    },
    selectTopic(id) {
      if(!data.topics.some(t=>t.id===id))throw new Error('Unknown topic.');
      remember();data.activeTopicId=id;return snapshot();
    },
    feedback(docId,action,topicId=data.activeTopicId) {
      if(!index.docs[docId])throw new Error('Unknown document.');
      const topic=data.topics.find(t=>t.id===topicId);
      if(!topic)throw new Error('Select a topic before providing feedback.');
      if(!['relevant','irrelevant','pin','remove','unpin','unrelevant','unirrelevant'].includes(action))throw new Error('Unknown feedback action.');
      remember();
      if(['relevant','irrelevant','remove'].includes(action)) {
        topic.feedback.relevant=topic.feedback.relevant.filter(id=>id!==docId);
        topic.feedback.irrelevant=topic.feedback.irrelevant.filter(id=>id!==docId);
      }
      if(action==='remove')topic.feedback.pinned=topic.feedback.pinned.filter(id=>id!==docId);
      if(action==='unpin')topic.feedback.pinned=topic.feedback.pinned.filter(id=>id!==docId);
      if(action==='unrelevant')topic.feedback.relevant=topic.feedback.relevant.filter(id=>id!==docId);
      if(action==='unirrelevant')topic.feedback.irrelevant=topic.feedback.irrelevant.filter(id=>id!==docId);
      if(action==='relevant')topic.feedback.relevant.push(docId);
      if(action==='irrelevant') {
        topic.feedback.irrelevant.push(docId);
        topic.feedback.pinned=topic.feedback.pinned.filter(id=>id!==docId);
      }
      if(action==='pin') {
        topic.feedback.irrelevant=topic.feedback.irrelevant.filter(id=>id!==docId);
        if(!topic.feedback.pinned.includes(docId))topic.feedback.pinned.push(docId);
      }
      return snapshot();
    },
    undo() {if(undoStack.length)data=undoStack.pop();return snapshot();},
    reset() {data=initial();undoStack.length=0;beforeTurns.clear();return snapshot();}
  };
}
