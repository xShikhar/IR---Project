const defaults={model:'hybrid',domain:null,diversity:false,rerank:'off',topicLock:'soft'};
export function makeConversationTour(conversation) {
  return {id:`original-${conversation.id}`,title:conversation.topic||conversation.title||conversation.id,
    category:'Original benchmark',level:'Midterm conversation',minutes:3,
    summary:'Replay the original questions one at a time in a separate demonstration session.',
    presenterNote:'These are the original conversation prompts, not a claim of relevance or an automatic evaluation. Resolve any interpretation choices before continuing.',
    steps:conversation.turns.map((entry,index)=>({title:`Question ${index+1}`,action:'search',query:typeof entry==='string'?entry:entry.query,
      observe:'Inspect the topic decision, carried context, source passages, and score explanations.',expect:{results:true}}))};
}

export async function executeDemoStep(step,previous,api) {
  const context={...previous};
  const sessionId=context.sessionId;
  const before=context.session;
  let payload,view='search',comparisonMode,traceTab=step.traceTab||'state';
  const post=(route,body)=>api.post(route,sessionId,body);
  const activeTopic=()=>context.session?.topics?.find(t=>t.id===context.session.activeTopicId);
  const ingest=result=>{
    context.response=result;
    if(result.session)context.session=result.session;
    if(result.clarification){context.pendingQuery=step.query||context.pendingQuery;context.pendingOptions=step.options||context.pendingOptions||{};}
    else {context.lastTurn=result.session?.turns?.at(-1)||context.lastTurn;context.pendingQuery=null;}
    return result;
  };
  const preview=async extra=>{
    const turn=context.lastTurn||context.session?.turns?.at(-1);
    if(!turn)throw new Error('Run a conversation question before previewing it.');
    const result=await post('preview',{turnId:turn.id,...extra});
    context.isPreview=true;context.currentFeedback=false;
    return ingest(result);
  };
  switch(step.action) {
    case 'search':
      context.isPreview=false;
      payload=ingest(await post('search',{...defaults,...step.options,query:step.query}));
      break;
    case 'clarify': {
      const option=context.response?.clarification?.options?.find(item=>item.title===step.choice);
      if(!option)throw new Error(`The requested interpretation "${step.choice}" is not offered by the corpus.`);
      context.isPreview=false;
      payload=ingest(await post('search',{...defaults,...context.pendingOptions,query:context.pendingQuery,interpretationId:option.id}));
      break;
    }
    case 'preview': payload=await preview(step.options||{});break;
    case 'feedback': {
      const topic=activeTopic();
      const docId=step.usePinned?topic?.feedback.pinned[0]:context.response?.results?.[step.resultIndex??0]?.docId;
      if(!docId)throw new Error('No matching evidence passage is available for this feedback step.');
      context.session=await post('feedback',{docId,topicId:topic.id,action:step.annotation});
      context.feedbackDocId=docId;
      if(step.annotation==='irrelevant')context.hiddenDocId=docId;
      const turn=context.lastTurn;
      payload=ingest(await post('preview',{...defaults,query:turn.query,topicId:turn.topicId}));
      context.isPreview=true;context.currentFeedback=true;
      break;
    }
    case 'undo': {
      context.session=await post('undo',{});
      const turn=context.session.turns.at(-1);
      if(turn)payload=ingest(await post('preview',{...defaults,query:turn.query,topicId:turn.topicId}));
      context.isPreview=true;context.currentFeedback=true;
      break;
    }
    case 'methods':
      context.methods=await post('methods',{turnId:context.lastTurn.id});payload=context.methods;break;
    case 'audit':
      context.contextAudit=await post('context-audit',{turnId:context.lastTurn.id});payload=context.contextAudit;break;
    case 'compare':
      context.comparison=await post('compare',{turnId:context.lastTurn.id});payload=context.comparison;view='compare';comparisonMode='ranking';break;
    case 'subjects':
      context.comparison=await post('compare',{...defaults,query:step.query,subjects:step.subjects});payload=context.comparison;view='compare';comparisonMode='subjects';break;
    case 'benchmark':
      context.comparison=await post('compare',{benchmarkId:step.benchmarkId,benchmarkRerank:'off'});payload=context.comparison;view='compare';comparisonMode='benchmark';break;
    case 'evaluation':context.evaluation=await api.get('evaluation');payload=context.evaluation;view='experiments';break;
    case 'inspect':payload=context.response;break;
    default:throw new Error(`Unknown demonstration action: ${step.action}`);
  }
  if(['compare','subjects','benchmark'].includes(step.action)&&payload?.session)context.session=payload.session;
  const expected=step.expect||{},response=context.response,trace=response?.trace||{};
  const topic=activeTopic();
  const checks=[];
  const check=(condition,detail)=>checks.push({passed:Boolean(condition),detail});
  if(expected.results)check(response?.results?.length>0,`${response?.results?.length||0} live evidence passages returned`);
  if(expected.clarification)check(response?.clarification?.options?.length>=2,'Multiple corpus-backed interpretations offered');
  if(expected.topic)check(topic?.title?.includes(expected.topic),`Active topic: ${topic?.title||'none'}`);
  if(expected.topics)check(context.session?.topics?.length===expected.topics,`${context.session?.topics?.length||0} separate topics retained`);
  if(expected.decision)check(trace.decision?.action===expected.decision,`Topic decision: ${trace.decision?.action||'unavailable'}`);
  if(expected.history)check(trace.termWeights?.some(t=>t.sources?.history>0),'Earlier aspect terms have source-turn provenance');
  if(expected.noHistory)check(Array.isArray(trace.termWeights)&&!trace.termWeights.some(t=>t.sources?.history>0),'Earlier aspect terms removed from this preview');
  if(expected.preview)check(step.action==='feedback'
    ?JSON.stringify(before?.turns)===JSON.stringify(context.session?.turns)
    :JSON.stringify(before)===JSON.stringify(context.session),'Saved conversation unchanged');
  if(expected.variants)check(context.contextAudit?.variants?.length===expected.variants,`${context.contextAudit?.variants?.length||0} real context variants compared`);
  if(expected.pinned)check(topic?.feedback?.pinned?.length>0&&response?.results?.[0]?.docId===topic.feedback.pinned[0],'Pinned passage leads the live ranking');
  if(expected.relevant)check(topic?.feedback?.relevant?.length>0,'Relevance annotation retained in this topic');
  if(expected.hidden)check(Array.isArray(response?.results)&&!response.results.some(doc=>doc.docId===context.hiddenDocId),'Rejected passage excluded from results');
  if(expected.notHidden)check(!topic?.feedback?.irrelevant?.includes(context.hiddenDocId),'Rejection removed by undo');
  if(expected.phrase)check(trace.phraseMatches?.some(item=>(item.matchingDocCount??item.count??0)>0),'Quoted phrase has positional matches');
  if(expected.methods)check(context.methods?.comparisons?.length===expected.methods&&context.methods.comparisons.every(item=>item.available),`${context.methods?.comparisons?.filter(item=>item.available).length||0} available retrieval methods inspected`);
  if(expected.profiler)check(Object.keys(trace.timings||{}).length>1,'Live per-stage latency measurements available');
  if(expected.lock)check(trace.subjectLock?.requested===expected.lock,`Requested ${expected.lock} lock; applied ${trace.subjectLock?.effective||'unknown'}`);
  if(expected.domain)check(response?.results?.length>0&&response.results.every(doc=>doc.domain===expected.domain),`All returned evidence belongs to ${expected.domain}`);
  if(expected.diversity!==undefined)check(trace.diversity===expected.diversity,'Diversity policy applied in the actual ranker');
  if(expected.rerank)check(trace.reranking?.policy===expected.rerank&&trace.reranking.evaluated>0,`${trace.reranking?.evaluated||0} passages scored by ${expected.rerank} reranking`);
  if(expected.comparison)check(context.comparison?.baseline?.results?.length>0&&context.comparison?.final?.results?.length>0,'Both engines returned evidence for the same question');
  if(expected.earlierContext)check(context.comparison?.replay?.priorTurnCount>0,'Both engines received the same earlier conversation context');
  if(expected.subjects)check(context.comparison?.subjects?.length===expected.subjects&&context.comparison.subjects.every(s=>s.results.length>0),'Separate evidence retrieved for both subjects');
  if(expected.benchmark)check(context.comparison?.replay?.benchmarkId===step.benchmarkId&&context.comparison?.relevance,'Graded benchmark replay and judgment coverage available');
  if(expected.evaluation)check(context.evaluation?.available&&context.evaluation?.systems?.length>0,'Measured experiment output loaded');
  const awaitingChoice=Boolean(response?.clarification)&&!expected.clarification&&step.action==='search';
  return {context,payload,view,comparisonMode,traceTab,awaitingChoice,
    check:{passed:!awaitingChoice&&checks.every(item=>item.passed),details:checks}};
}
