import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Composer, TurnResults, Welcome } from './components/SearchWorkspace.jsx';
import WorkspaceInspector from './components/WorkspaceInspector.jsx';
import { CompareView, ExperimentsView } from './components/ResearchViews.jsx';
import { exportSession, getHealth, getResource, getSessionId, postAction, resetSession } from './workspaceApi.js';
import { Icon, Status } from './ui.jsx';
import {DemoLab,DemoGuide} from './components/DemoLab.jsx';
import {executeDemoStep,makeConversationTour} from './demo/demoRunner.js';

const tabs = [
  { id: 'search', title: 'Search', icon: 'search' },
  { id: 'demos', title: 'Demo lab', icon: 'bolt' },
  { id: 'compare', title: 'Compare', icon: 'compare' },
  { id: 'experiments', title: 'Experiments', icon: 'chart' },
];
const defaultSettings = { model: 'hybrid', domain: '', diversity: false, rerank: 'off', topicLock: 'soft' };
const snapshot = payload => payload.session ?? payload;

function Header({ view, onNavigate, health, isConnecting, mobilePane, onPane }) {
  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" type="button" aria-label="Toggle topic sidebar" aria-expanded={mobilePane === 'topics'} onClick={() => onPane('topics')}><Icon name="menu" /></button>
      <button className="brand" type="button" onClick={() => onNavigate('search')} aria-label="TurnTrace 2 workspace">
        <span className="brand-mark"><Icon name="trace" size={23} /></span><span>TurnTrace<span className="brand-version">2</span></span>
      </button>
      <nav aria-label="Workspace views" className="main-nav">
        {tabs.map(tab => <button className={view === tab.id ? 'active' : ''} type="button" key={tab.id} aria-current={view === tab.id ? 'page' : undefined}
          onClick={() => onNavigate(tab.id)}><Icon name={tab.icon} size={18} />{tab.title}</button>)}
      </nav>
      <div className="header-right">
        <span className="backend-label" title={health?.totalDocs ? `${health.totalDocs.toLocaleString()} indexed passages` : undefined}>
          <span className={`status-dot ${health?.indexLoaded ? 'online' : 'offline'}`} />
          {health?.indexLoaded ? 'Corpus online' : isConnecting ? 'Connecting…' : 'Corpus unavailable'}
        </span>
        {view === 'search' && <button className="icon-button mobile-inspector" type="button" aria-label="Toggle trace inspector"
          aria-expanded={mobilePane === 'trace'} onClick={() => onPane('trace')}><Icon name="panel" size={21} /></button>}
      </div>
    </header>
  );
}

function Sidebar({ session, busy, newTopic, health, onNewTopic, onTopic, onUndo, onExport, onReset, onClose }) {
  const topics = session?.topics ?? [];
  return (
    <>
      <div className="sidebar-start">
        <div className="sidebar-top"><span className="eyebrow">WORKSPACE</span>
          <button className="icon-button close-panel" type="button" aria-label="Close topic sidebar" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <button className="new-topic-button" type="button" disabled={busy} onClick={onNewTopic}><Icon name="plus" size={20} /> New topic</button>
        <div className="topics-heading"><h2>Topics</h2><span>{topics.length}</span></div>
      </div>
      <div className="sidebar-topics">
        {topics.length === 0 && <div className="sidebar-empty"><Icon name="topic" size={19} /><p>Your topics appear here as you search.</p></div>}
        {topics.map(topic => {
          const selected = !newTopic && session.activeTopicId === topic.id;
          const marked = topic.feedback?.pinned?.length ?? 0;
          return <button type="button" key={topic.id} disabled={busy} title={topic.title} className={`topic-button ${selected ? 'selected' : ''}`}
            aria-current={selected ? 'true' : undefined} onClick={() => onTopic(topic.id)}>
            <Icon name="topic" size={18} /><span><strong>{topic.title}</strong>
              <small>{topic.turnCount} {topic.turnCount === 1 ? 'turn' : 'turns'}{marked > 0 ? ` · ${marked} pinned` : ''}</small></span>
          </button>;
        })}
      </div>
      <div className="sidebar-end">
        <div className="session-actions">
          <button type="button" disabled={busy || !session?.canUndo} onClick={onUndo}><Icon name="undo" size={18} /> Undo last change</button>
          <button type="button" disabled={busy || !session} onClick={onExport}><Icon name="download" size={17} /> Export workspace</button>
          <button type="button" disabled={busy || !session?.turns?.length} onClick={onReset}><Icon name="reset" size={17} /> Reset workspace</button>
        </div>
        <div className="sidebar-foot"><Icon name="layers" size={17} /><span>Local corpus{health?.totalDocs > 0 && <small>{health.totalDocs.toLocaleString()} indexed passages</small>}</span></div>
      </div>
    </>
  );
}

function ResetDialog({ onClose, onReset }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="reset-title" onCancel={onClose}>
      <span className="empty-icon"><Icon name="reset" size={24} /></span>
      <h2 id="reset-title">Reset this workspace?</h2>
      <p>This clears the topics, searches, and feedback in this session.</p>
      <div className="dialog-actions">
        <button className="button" type="button" onClick={onClose} autoFocus>Cancel</button>
        <button className="button danger" type="button" onClick={onReset}>Reset workspace</button>
      </div>
    </dialog>
  );
}

export default function App() {
  const [sessionId,setSessionId] = useState(getSessionId);
  const [session, setSession] = useState(null);
  const [health, setHealth] = useState(null);
  const [connecting, setConnecting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [bootAttempt, setBootAttempt] = useState(0);
  const [scenarios, setScenarios] = useState([]);
  const [scenario, setScenario] = useState(null);
  const [view, setView] = useState('search');
  const [mobilePane, setMobilePane] = useState(null);
  const [traceTab, setTraceTab] = useState('state');
  const [settings, setSettings] = useState(defaultSettings);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState('');
  const [clarification, setClarification] = useState(null);
  const [selectedTurnId, setSelectedTurnId] = useState(null);
  const [savedResults, setSavedResults] = useState({});
  const [preview, setPreview] = useState(null);
  const [exclusions, setExclusions] = useState([]);
  const [newTopic, setNewTopic] = useState(false);
  const [document, setDocument] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [methods, setMethods] = useState(null);
  const [contextAudit, setContextAudit] = useState(null);
  const [comparePreset, setComparePreset] = useState('');
  const [evaluation, setEvaluation] = useState(null);
  const [evaluationError, setEvaluationError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [demoCatalog,setDemoCatalog]=useState(null);
  const [demoCatalogError,setDemoCatalogError]=useState('');
  const [demoLoading,setDemoLoading]=useState(false);
  const [activeDemo,setActiveDemo]=useState(null);
  const [demoComparisonMode,setDemoComparisonMode]=useState('ranking');
  const returnWorkspace=useRef(null);
  const installedSession=useRef(null);
  const restoringSettings=useRef(null);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const operation = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    if(installedSession.current===sessionId){installedSession.current=null;setConnecting(false);return ()=>controller.abort();}
    setConnecting(true);
    setBootError('');
    const sessionRequest=getResource('session', sessionId, controller.signal)
      .then(data => { if (!controller.signal.aborted) setSession(snapshot(data)); })
      .catch(err => { if (!controller.signal.aborted) setBootError(`Could not connect to the workspace. ${err.message}`); });
    const healthRequest=getHealth(controller.signal)
      .then(data => { if (!controller.signal.aborted) setHealth(data); })
      .catch(() => { if (!controller.signal.aborted) setHealth(null); });
    Promise.allSettled([sessionRequest,healthRequest]).then(()=>{if(!controller.signal.aborted)setConnecting(false);});
    getResource('scenarios', undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setScenarios(Array.isArray(data) ? data : data.scenarios ?? []); })
      .catch(() => {});
    return () => controller.abort();
  }, [sessionId, bootAttempt]);

  const topic = session?.topics?.find(item => item.id === session.activeTopicId);
  const turns = (session?.turns ?? []).filter(turn => turn.topicId === topic?.id);
  const turn = newTopic ? null : turns.find(item => item.id === selectedTurnId) ?? turns.at(-1);
  const semantic = health?.semantic?.semantic ?? health?.semantic;
  const saved = turn && savedResults[turn.id];
  const response = preview?.turnId === turn?.id ? preview?.result ?? saved : saved;
  const visiblePreview = preview?.turnId === turn?.id ? preview : null;

  const focusInput = useCallback(() => requestAnimationFrame(() => inputRef.current?.focus()), []);

  function navigate(next) {
    setView(next);
    setError('');
    setNotice('');
    setMobilePane(null);
    if (next === 'compare') setComparePreset(turn?.query ?? '');
  }

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') setMobilePane(null);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setView('search');
        setMobilePane(null);
        focusInput();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusInput]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [view, turn?.id, clarification?.query, pending, newTopic]);

  useEffect(() => {
    if(restoringSettings.current===sessionId){restoringSettings.current=null;return;}
    if (!turn?.options) return;
    setSettings({
      model: turn.options.model ?? defaultSettings.model,
      domain: turn.options.domain ?? defaultSettings.domain,
      diversity: turn.options.diversity ?? defaultSettings.diversity,
      rerank: turn.options.rerank ?? defaultSettings.rerank,
      topicLock: turn.options.topicLock ?? defaultSettings.topicLock,
    });
  }, [sessionId,turn?.id, turn?.options?.model, turn?.options?.domain, turn?.options?.diversity, turn?.options?.rerank, turn?.options?.topicLock]);

  const loadEvaluation = useCallback(async () => {
    setEvaluation(null);
    setEvaluationError('');
    try {
      setEvaluation(await getResource('evaluation'));
    } catch (err) {
      setEvaluationError(`Could not load evaluation results. ${err.message}`);
    }
  }, []);

  useEffect(() => {
    if (view === 'experiments') loadEvaluation();
  }, [view, loadEvaluation]);

  const loadDemos=useCallback(async()=>{
    setDemoLoading(true);setDemoCatalogError('');
    try{setDemoCatalog(await getResource('demos'));}
    catch(err){setDemoCatalogError(`Could not load the demo catalog. ${err.message}`);}
    finally{setDemoLoading(false);}
  },[]);
  useEffect(()=>{if(view==='demos'&&!demoCatalog&&!demoLoading&&!demoCatalogError)loadDemos();},[view,demoCatalog,demoLoading,demoCatalogError,loadDemos]);

  function searchOptions() {
    return { ...settings, domain: settings.domain || null };
  }

  function clearSelectedResult() {
    setClarification(null);
    setPreview(null);
    setExclusions([]);
    setDocument(null);
    setMethods(null);
    setContextAudit(null);
  }

  async function run(name, fn) {
    if (operation.current) return;
    operation.current = true;
    setBusy(name);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (err) {
      setError(err.message || 'The request failed. Please try again.');
    } finally {
      operation.current = false;
      setBusy('');
    }
  }

  function submit(query = input, interpretationId = undefined, forceNewTopic = false, senseOptions = {}) {
    const trimmed = query.trim();
    if (!trimmed || connecting || operation.current) return;
    const options = (interpretationId || senseOptions.customSense) && clarification ? { ...clarification.options, ...senseOptions } : {
      ...searchOptions(), newTopic: forceNewTopic || newTopic || undefined,
      ...senseOptions,
    };

    run('search', async () => {
      setPending(trimmed);
      setDocument(null);
      setContextAudit(null);
      try {
        const result = await postAction('search', sessionId, { ...options, query: trimmed, interpretationId });
        setSession(result.session);
        setBootError('');
        setInput(previous => previous.trim() === trimmed ? '' : previous);
        setPreview(null);
        setExclusions([]);
        if (result.clarification) {
          setClarification({ data: result.clarification, query: trimmed, trace: result.trace, options });
          return;
        }
        const committedTurn = result.session.turns.at(-1);
        if (committedTurn) {
          setSavedResults(previous => ({ ...previous, [committedTurn.id]: result }));
          setSelectedTurnId(committedTurn.id);
        }
        setClarification(null);
        setNewTopic(false);
        setComparison(null);
        setScenario(previous => previous?.turns[previous.step]?.trim() === trimmed
          ? { ...previous, step: previous.step + 1 } : previous);
        const guidedChoice=activeDemo&&(activeDemo.waiting||activeDemo.tour.steps[activeDemo.index]?.action==='clarify')&&trimmed===activeDemo.context.pendingQuery;
        if(guidedChoice){
          const expectedChoice=activeDemo.tour.steps[activeDemo.index]?.choice;
          const selectedTopic=result.session.topics.find(item=>item.id===result.session.activeTopicId);
          const verified=result.results?.length>0&&(!expectedChoice||selectedTopic?.title===expectedChoice);
          setActiveDemo(previous=>({...previous,index:previous.index+(verified?1:0),waiting:false,lastStepTitle:previous.tour.steps[previous.index].title,lastView:'search',
            context:{...previous.context,response:result,session:result.session,lastTurn:committedTurn,pendingQuery:null,isPreview:false},
            results:verified?[...previous.results,{title:previous.tour.steps[previous.index].title,passed:true}]:previous.results,
            check:{passed:verified,details:[{passed:verified,detail:verified?'Interpretation selected; live evidence returned.':'The selected interpretation did not match this tour. Restart to follow its specified choice.'}]}}));
        }
      } catch (err) {
        setInput(previous => previous || trimmed);
        throw err;
      } finally {
        setPending('');
      }
    });
  }

  function exploreTerm(term) {
    submit(input.trim() || term, undefined, false, { senseQuery: term });
  }

  function switchTopic(topicId) {
    run('topic', async () => {
      if (topicId !== session.activeTopicId) setSession(snapshot(await postAction('topic', sessionId, { topicId })));
      setSelectedTurnId(null);
      setNewTopic(false);
      clearSelectedResult();
      navigate('search');
    });
  }

  function chooseTurn(nextId) {
    clearSelectedResult();
    setSelectedTurnId(nextId);
    setError('');
    setNotice('');
  }

  async function requestPreview(terms, currentTopic = false, questionOnly = false) {
    setMethods(null);
    const useCurrent = !questionOnly && (currentTopic || visiblePreview?.currentTopic);
    const contextVariant = questionOnly || useCurrent ? undefined : visiblePreview?.contextVariant;
    const result = await postAction('preview', sessionId, {
      ...searchOptions(), query: turn.query, topicId: useCurrent ? turn.topicId : undefined, excludedTerms: terms,
      interpretationId: turn.options?.interpretationId,
      turnId: useCurrent ? undefined : turn.id,
      questionOnly, contextVariant,
    });
    setPreview({ result, turnId: turn.id, currentTopic: useCurrent, questionOnly, contextVariant });
    setExclusions(terms);
    setDocument(null);
  }

  function rescore(terms = exclusions) {
    if (turn) run('preview', () => requestPreview(terms));
  }

  function recordFeedback(doc, action) {
    run('feedback', async () => {
      const updated = await postAction('feedback', sessionId, { docId: doc.docId, action, topicId: turn.topicId });
      setSession(snapshot(updated));
      setNotice({ relevant: 'Passage marked relevant.', irrelevant: 'Passage marked irrelevant.', pin: 'Passage pinned to this topic.', remove: 'Passage feedback cleared.', unpin:'Passage unpinned.', unrelevant:'Relevance mark removed.', unirrelevant:'Exclusion removed.' }[action]);
      await requestPreview(exclusions, true);
    });
  }

  function undo() {
    run('undo', async () => {
      const updated = snapshot(await postAction('undo', sessionId));
      setSession(updated);
      setSelectedTurnId(null);
      setNewTopic(false);
      clearSelectedResult();
      setNotice('Last workspace change undone.');
    });
  }

  function clearWorkspace() {
    setConfirmReset(false);
    run('reset', async () => {
      const result = snapshot(await resetSession(sessionId));
      setSession(Array.isArray(result.turns) ? result : snapshot(await getResource('session', sessionId)));
      setSelectedTurnId(null);
      setSavedResults({});
      setScenario(null);
      setInput('');
      setSettings(defaultSettings);
      setNewTopic(false);
      setComparison(null);
      setComparePreset('');
      clearSelectedResult();
      navigate('search');
    });
  }

  function startNewTopic() {
    clearSelectedResult();
    setInput('');
    setNewTopic(true);
    setScenario(null);
    navigate('search');
    focusInput();
  }

  function startScenario(item) {
    if (!item.turns?.length || operation.current) return;
    setScenario({ ...item, step: 0 });
    setInput('');
    submit(item.turns[0], undefined, true);
  }

  function compare(query, subjects, midterm, benchmarkId, benchmarkRerank) {
    run('compare', async () => {
      const savedTurn = subjects ? null : turn?.query === query ? turn : session?.turns?.findLast(entry => entry.query === query);
      const result = await postAction('compare', sessionId, {
        ...(savedTurn ? {} : searchOptions()), query: query || undefined, subjects, midterm, benchmarkId, benchmarkRerank,
        turnId: savedTurn?.id,
      });
      setComparison({ query, ...result });
    });
  }

  const loadComparisonBenchmarks = useCallback(signal => getResource('comparison-benchmarks', sessionId, signal), [sessionId]);

  function compareMethods() {
    if (!turn) return;
    run('methods', async () => {
      setMethods(await postAction('methods', sessionId, {
        turnId: turn.id, questionOnly: Boolean(visiblePreview?.questionOnly),
        ...(visiblePreview ? { excludedTerms: exclusions, topicLock: visiblePreview.result.trace?.subjectLock?.requested } : {}),
      }));
    });
  }

  function runContextAudit() {
    if (!turn) return;
    run('context-audit', async () => {
      setContextAudit(await postAction('context-audit', sessionId, { turnId: turn.id }));
    });
  }

  function previewContextVariant(contextVariant) {
    if (!turn) return;
    run('preview', async () => {
      const result = await postAction('preview', sessionId, { turnId: turn.id, contextVariant });
      setPreview({ result, turnId: turn.id, contextVariant });
      setExclusions(turn.options.excludedTerms ?? []);
      setDocument(null);
      setMethods(null);
    });
  }

  function startDemo(tour){
    if(!tour||operation.current)return;
    run('demo-start',async()=>{
      if(!activeDemo)returnWorkspace.current={sessionId,savedResults,selectedTurnId,settings,preview,comparison,comparePreset,
        input,scenario,newTopic,clarification,exclusions,document,methods,contextAudit,traceTab,notice,error};
      const nextId=`demo_${crypto.randomUUID().replaceAll('-','')}`;
      const clean=await getResource('session',nextId);
      if(activeDemo)await resetSession(activeDemo.context.sessionId);
      installedSession.current=nextId;
      setSessionId(nextId);setSession(clean);setSavedResults({});setSelectedTurnId(null);setSettings(defaultSettings);
      clearSelectedResult();setComparison(null);setScenario(null);setInput('');setNewTopic(false);
      setActiveDemo({tour,index:0,results:[],check:null,waiting:false,lastView:'search',context:{sessionId:nextId,session:clean}});
      setView('search');setMobilePane(null);
    });
  }

  function exitDemo(){
    if(!activeDemo||operation.current)return;
    run('demo-exit',async()=>{
      const savedWorkspace=returnWorkspace.current;
      const restored=await getResource('session',savedWorkspace.sessionId);
      await resetSession(activeDemo.context.sessionId);
      installedSession.current=savedWorkspace.sessionId;restoringSettings.current=savedWorkspace.sessionId;
      setSessionId(savedWorkspace.sessionId);setSession(restored);setSavedResults(savedWorkspace.savedResults);
      setSelectedTurnId(savedWorkspace.selectedTurnId);setSettings(savedWorkspace.settings);
      clearSelectedResult();setPreview(savedWorkspace.preview);setComparison(savedWorkspace.comparison);
      setClarification(savedWorkspace.clarification);setExclusions(savedWorkspace.exclusions);setDocument(savedWorkspace.document);
      setMethods(savedWorkspace.methods);setContextAudit(savedWorkspace.contextAudit);setTraceTab(savedWorkspace.traceTab);
      setNotice(savedWorkspace.notice);setError(savedWorkspace.error);
      setComparePreset(savedWorkspace.comparePreset);setActiveDemo(null);returnWorkspace.current=null;
      setScenario(savedWorkspace.scenario);setInput(savedWorkspace.input);setNewTopic(savedWorkspace.newTopic);setView('search');setMobilePane(null);
    });
  }

  function runDemoStep(){
    if(!activeDemo||operation.current||activeDemo.waiting)return;
    const step=activeDemo.tour.steps[activeDemo.index];
    if(!step)return;
    run('demo-step',async()=>{
      const result=await executeDemoStep(step,{...activeDemo.context,session},
        {post:postAction,get:resource=>getResource(resource)});
      const next=result.context;
      if(next.session)setSession(next.session);
      if(next.response){
        const trace=next.response.trace||{};
        setSettings({model:trace.requestedModel||defaultSettings.model,domain:trace.filters?.domain||'',
          diversity:trace.diversity??false,rerank:trace.reranking?.policy||'off',topicLock:trace.subjectLock?.requested||'soft'});
        const last=next.lastTurn;
        setSelectedTurnId(last?.id||null);
        setClarification(next.response.clarification?{data:next.response.clarification,query:next.pendingQuery,trace:next.response.trace,options:{...defaultSettings,...step.options}}:null);
        if(last){
          if(next.isPreview)setPreview({result:next.response,turnId:last.id,currentTopic:Boolean(next.currentFeedback),contextVariant:step.options?.contextVariant});
          else {setSavedResults(previous=>({...previous,[last.id]:next.response}));setPreview(null);}
        }
        setExclusions(next.response.trace?.filters?.excludedTerms||[]);
      }
      if(next.comparison)setComparison(next.comparison);
      if(next.methods)setMethods(next.methods);
      if(next.contextAudit)setContextAudit(next.contextAudit);
      if(next.evaluation)setEvaluation(next.evaluation);
      if(result.comparisonMode)setDemoComparisonMode(result.comparisonMode);
      setDocument(null);setNewTopic(false);setInput('');setTraceTab(result.traceTab==='novelty'?'profile':result.traceTab);
      setView(result.view);setMobilePane(null);
      setActiveDemo(previous=>({...previous,context:next,waiting:result.awaitingChoice,check:result.awaitingChoice?null:result.check,
        lastStepTitle:step.title,lastView:result.view,index:result.check.passed?previous.index+1:previous.index,
        results:result.check.passed?[...previous.results,{title:step.title,...result.check}]:previous.results}));
    });
  }

  const currentTrace = pending ? null : clarification?.trace ?? response?.trace;
  const showTurn = Boolean(turn || pending || clarification);
  const searchDisabled = Boolean(busy || connecting);
  const composer = (<Composer input={input} setInput={setInput} inputRef={inputRef} settings={settings} setSettings={setSettings}
          onExploreTerm={exploreTerm}
          semantic={semantic} reranker={health?.semantic?.reranker} busy={searchDisabled} onSubmit={() => submit()} onPreview={() => rescore()}
          canPreview={Boolean(turn && !clarification)} scenario={scenario} onDismissScenario={() => setScenario(null)}
          onNextScenario={() => { setInput(scenario.turns[scenario.step]); focusInput(); }} />);
  const togglePane = name => setMobilePane(previous => previous === name ? null : name);

  return (
    <div className={`workspace view-${view} ${view === 'search' && !showTurn ? 'is-landing' : ''}`}>
      <Header view={view} onNavigate={navigate} health={health} isConnecting={connecting} mobilePane={mobilePane} onPane={togglePane} />
      {mobilePane && <button className="drawer-overlay" type="button" aria-label="Close open panel" onClick={() => setMobilePane(null)} />}
      <aside className={`sidebar ${mobilePane === 'topics' ? 'drawer-open' : ''}`} aria-label="Topic workspace">
        <Sidebar session={session} health={health} busy={searchDisabled||Boolean(activeDemo)} newTopic={newTopic} onNewTopic={startNewTopic}
          onTopic={switchTopic} onUndo={undo} onExport={() => run('export', () => exportSession(sessionId))}
          onReset={() => setConfirmReset(true)} onClose={() => setMobilePane(null)} />
      </aside>
      <main className="main-pane">
        {activeDemo&&<DemoGuide demo={activeDemo} busy={Boolean(busy)} connecting={connecting} onRun={runDemoStep} onExit={exitDemo}
          onRestart={()=>startDemo(activeDemo.tour)} onCatalog={()=>navigate('demos')}/>}
        <div className="main-scroll" ref={scrollRef}>
          {bootError && view !== 'experiments' && <div className="message-wrap"><Status kind="error">{bootError}{' '}
            <button className="text-button" type="button" onClick={() => setBootAttempt(value => value + 1)}>Reconnect</button>
          </Status></div>}
          {error && <div className="message-wrap"><Status kind="error">{error}</Status></div>}
          {view === 'search' && <>
            {notice && <div className="message-wrap"><Status>{notice}</Status></div>}
            {busy === 'preview' && <div className="message-wrap"><Status kind="loading">Re-scoring the selected question…</Status></div>}
            {showTurn ? <TurnResults turns={turns} turn={turn} response={response} preview={visiblePreview} pending={pending}
              clarification={clarification} topic={newTopic ? null : topic} busy={searchDisabled} onTurn={chooseTurn}
              onInterpret={id => submit(clarification.query, id)} onCancelClarification={activeDemo?undefined:()=>setClarification(null)}
              onCustomFocus={customSense => submit(clarification.query, undefined, false, { customSense })}
              onPreview={() => rescore()} onQuestionOnly={() => run('preview', () => requestPreview([], false, true))}
              onRestore={visiblePreview && saved ? clearSelectedResult : null}
              feedbackDisabled={Boolean(activeDemo)} onFeedback={recordFeedback} onInspect={doc => { setDocument(doc); setMobilePane('trace'); }}
              onTrace={id => { setDocument(null); setTraceTab(id); setMobilePane('trace'); }}
              onCompare={() => { navigate('compare'); if (turn) compare(turn.query); }} />
              : <Welcome composer={activeDemo ? null : composer} onOpenDemos={() => navigate('demos')} scenarios={scenarios} onScenario={startScenario} newTopic={newTopic} disabled={searchDisabled} />}
          </>}
          {view === 'demos' && <DemoLab catalog={demoCatalog} error={demoCatalogError} loading={demoLoading} onReload={loadDemos} health={health}
            busy={Boolean(busy)||connecting} active={activeDemo} onStart={startDemo} onResume={()=>setView(activeDemo.lastView||'search')}
            onConversation={conversation=>startDemo(makeConversationTour(conversation))}/>}
          {view === 'compare' && <CompareView key={activeDemo?demoComparisonMode:'normal'} initialMode={activeDemo?demoComparisonMode:'ranking'} preset={activeDemo?comparison?.query:comparePreset} comparison={comparison} busy={busy === 'compare'||busy==='demo-step'} onCompare={compare} loadBenchmarks={loadComparisonBenchmarks} />}
          {view === 'experiments' && <ExperimentsView evaluation={evaluation} error={evaluationError} onReload={loadEvaluation} />}
        </div>
        {view === 'search' && showTurn && !activeDemo && composer}
      </main>
      {view === 'search' && <aside className={`inspector ${mobilePane === 'trace' ? 'drawer-open' : ''}`} aria-label="IR Execution Trace">
        <WorkspaceInspector trace={currentTrace} semantic={semantic} doc={document} exclusions={exclusions}
          active={traceTab} setActive={setTraceTab}
          clarification={clarification?.data}
          methods={methods?.turnId === turn?.id ? methods : null} onCompareMethods={compareMethods} comparingMethods={busy === 'methods'}
          contextAudit={contextAudit?.turnId === turn?.id ? contextAudit : null} onRunContextAudit={runContextAudit}
          onPreviewVariant={previewContextVariant} auditingContext={busy === 'context-audit'}
          disabled={searchDisabled || !turn || Boolean(clarification)} onCloseDoc={() => setDocument(null)} onClose={() => setMobilePane(null)}
          onTerm={term => rescore(exclusions.includes(term) ? exclusions.filter(item => item !== term) : [...exclusions, term])} />
      </aside>}
      {confirmReset && <ResetDialog onClose={() => setConfirmReset(false)} onReset={clearWorkspace} />}
    </div>
  );
}
