import React,{useMemo,useState} from 'react';
import {Icon,Status} from '../ui.jsx';

const categoryIcons={Conversation:'branch',Clarification:'question',Explainability:'trace',Interaction:'pin',Retrieval:'layers',Comparison:'compare'};
export function demoRequirements(tour,health) {
  return (tour?.requires||[]).filter(name=>name==='semantic'?!health?.semantic?.semantic?.available:!health?.semantic?.reranker?.available);
}

export function DemoLab({catalog,error,loading,onReload,health,busy,active,onStart,onResume,onConversation}) {
  const [category,setCategory]=useState('All');
  const [selectedId,setSelectedId]=useState(null);
  const [conversationId,setConversationId]=useState('');
  const tours=catalog?.tours||[];
  const categories=['All',...new Set(tours.map(t=>t.category))];
  const visible=tours.filter(t=>category==='All'||t.category===category);
  const selected=tours.find(t=>t.id===selectedId)||visible[0]||tours[0];
  const unavailable=demoRequirements(selected,health);
  const minutes=useMemo(()=>tours.reduce((sum,t)=>sum+t.minutes,0),[tours]);
  return <div className="demo-page">
    <header className="demo-hero">
      <div><span className="eyebrow">PRESENTATION WORKSPACE</span><h1>Demo lab</h1>
        <p>Show what makes TurnTrace different. Run real conversations, inspect the decisions, and explain the evidence behind each feature.</p></div>
      <div className="demo-summary"><strong>{tours.length||'—'}</strong><span>guided walkthroughs</span><small>Choose a 2–3 minute tour<br/>or build your own presentation.</small></div>
    </header>
    {active&&<div className="demo-resume"><Icon name="bolt" size={20}/><span><strong>{active.index>=active.tour.steps.length?'A demo is complete':'A demo is in progress'}</strong><small>{active.tour.title}</small></span><button type="button" className="button compact" onClick={onResume}>Resume walkthrough</button></div>}
    {loading?<Status kind="loading">Loading demonstration conversations…</Status>:error?<Status kind="error">{error} <button type="button" className="text-button" onClick={onReload}>Retry loading demos</button></Status>:<>
      <div className="demo-section-title"><div><h2>Feature walkthroughs</h2><p>Start with conversation, then move into the retrieval engine.</p></div><span>{minutes} minutes of optional material</span></div>
      <nav className="demo-filters" aria-label="Demo categories">{categories.map(name=><button type="button" key={name} aria-pressed={category===name} onClick={()=>{setCategory(name);setSelectedId(null);}}>{name}</button>)}</nav>
      <div className="demo-catalog-layout">
        <div className="demo-cards">{visible.map(tour=><button type="button" key={tour.id} aria-label={tour.title} aria-pressed={selected?.id===tour.id} className={`demo-card ${selected?.id===tour.id?'selected':''}`} onClick={()=>setSelectedId(tour.id)}>
          <div className="demo-card-top"><span className="demo-card-icon"><Icon name={categoryIcons[tour.category]||'file'} size={21}/></span><span>{tour.minutes} min · {tour.steps.length} steps</span></div>
          <small className="demo-level">{tour.level}</small><h3>{tour.title}</h3><p>{tour.summary}</p>
          <div className="demo-tags">{tour.features.slice(0,3).map(feature=><span key={feature}>{feature}</span>)}</div>
        </button>)}</div>
        {selected&&<section className="demo-outline" aria-label="Selected walkthrough">
          <div className="demo-outline-heading"><Icon name={categoryIcons[selected.category]||'file'} size={22}/><span>{selected.category}</span></div>
          <h2>{selected.title}</h2><p>{selected.summary}</p>
          <ol>{selected.steps.map((step,index)=><li key={`${selected.id}-${index}`}><span>{index+1}</span><div><strong>{step.title}</strong>{step.query&&<small>“{step.query}”</small>}</div></li>)}</ol>
          <details className="demo-presenter"><summary>Presenter notes</summary><p>{selected.presenterNote}</p></details>
          {unavailable.length>0&&<Status kind="error">Prepare the local {unavailable.join(' and ')} model before running this walkthrough.</Status>}
          <button type="button" className="button primary demo-start" disabled={busy||unavailable.length>0} onClick={()=>onStart(selected)}><Icon name="bolt" size={18}/>Start guided demo</button>
          <small className="demo-isolation"><Icon name="info" size={14}/> Runs in a separate session. Your workspace is preserved.</small>
        </section>}
      </div>
      <section className="demo-originals"><div className="demo-originals-icon"><Icon name="clock" size={25}/></div><div><h2>Original benchmark conversations</h2><p>Replay the preloaded midterm dialogues, one question at a time. Resolve any ambiguity interactively.</p>
        <label><span className="visually-hidden">Original benchmark conversation</span><select aria-label="Original benchmark conversation" value={conversationId} onChange={e=>setConversationId(e.target.value)}>
          <option value="">Choose a conversation</option>{catalog?.conversations?.map(c=><option key={c.id} value={c.id}>{c.title} · {c.turns.length} questions</option>)}
        </select></label></div><button type="button" className="button" disabled={busy||!conversationId} onClick={()=>onConversation(catalog.conversations.find(c=>c.id===conversationId))}>Start conversation</button>
      </section>
      <p className="demo-honesty"><Icon name="info" size={16}/> The walkthroughs check observable behavior. They do not fabricate relevance grades or replace the measured experiments.</p>
    </>}
  </div>;
}

export function DemoGuide({demo,busy,connecting,onRun,onExit,onRestart,onCatalog}) {
  const completed=demo.index>=demo.tour.steps.length;
  const step=demo.tour.steps[demo.index];
  const done=demo.results.length;
  return <section className={`demo-guide ${completed?'complete':''}`} aria-label="Guided demonstration">
    <div className="demo-guide-top"><span className="demo-live"><Icon name="bolt" size={15}/> LIVE DEMO</span><strong>{demo.tour.title}</strong>
      <button className="text-button" type="button" onClick={onCatalog} disabled={busy}>View guide</button>
      <button className="icon-button" type="button" aria-label="Exit demo and restore workspace" disabled={busy} onClick={onExit}><Icon name="close" size={17}/></button></div>
    <div className="demo-guide-body"><div className="demo-guide-copy">
      <span className="eyebrow">{completed?`${done} VERIFIED STEPS`:`STEP ${demo.index+1} OF ${demo.tour.steps.length}`}</span>
      <h2>{completed?'Walkthrough complete':step.title}</h2>
      <p>{completed?'You have demonstrated these features using live searches and real execution traces.':step.observe}</p>
      {!completed&&step.query&&<code className="demo-question">{step.query}</code>}
      {demo.waiting&&<Status>Choose an interpretation below to finish this conversation step.</Status>}
      {demo.check&&<div className={`demo-step-check ${demo.check.passed?'passed':'failed'}`} role="status"><Icon name={demo.check.passed?'check':'alert'} size={16}/><span>{demo.check.passed?`Verified: ${demo.lastStepTitle}.`:'The expected behavior was not verified. Review the response or restart this tour.'}</span></div>}
      {demo.check?.details?.length>0&&<details className="demo-check-details"><summary>Observed behavior</summary><ul>{demo.check.details.map((item,i)=><li key={i}><Icon name={item.passed?'check':'alert'} size={13}/>{item.detail}</li>)}</ul></details>}
    </div><div className="demo-guide-actions">
      {!completed&&<button type="button" className="button primary" disabled={busy||connecting||demo.waiting||demo.check?.passed===false} onClick={onRun}><Icon name="bolt" size={17}/>{busy?'Running…':demo.index===0?'Run first step':'Run next step'}</button>}
      {completed&&<button type="button" className="button primary" disabled={busy} onClick={onExit}>Return to workspace</button>}
      <button type="button" className="text-button" disabled={busy} onClick={onRestart}>Restart tour</button>
      <small>{demo.results.length} / {demo.tour.steps.length} steps completed</small>
    </div></div>
    <div className="demo-progress" aria-label="Tour progress">{demo.tour.steps.map((entry,index)=><span key={index} className={index<demo.index?'done':index===demo.index?'current':''} title={entry.title}/>)}</div>
  </section>;
}
