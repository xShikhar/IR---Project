import React, { useRef, useState } from 'react';
import { Empty, Icon, domainNames, label, modelNames, numeric } from '../ui.jsx';

const decisionNames = { CREATE: 'New topic', CONTINUE: 'Continue topic', RESUME: 'Resume topic', CLARIFY: 'Clarification needed', RAW_QUERY: 'Question only' };
const tabs = [
  { id: 'state', icon: 'branch', title: 'State & Decision' },
  { id: 'rewrite', icon: 'layers', title: 'Rewrite & Phrase' },
  { id: 'postings', icon: 'chart', title: 'Postings & Fusion' },
  { id: 'profile', icon: 'clock', title: 'Novelty & Profiler' },
];
const formatModel = model => modelNames[model] ?? label(model);
const count = value => Number.isFinite(value) ? value.toLocaleString() : '—';

function Stage({ icon, title, children, open }) {
  return (
    <details className="trace-stage" open={open}>
      <summary><span className="stage-icon"><Icon name={icon} size={17} /></span>
        <strong>{title}</strong><Icon name="down" size={15} /></summary>
      <div className="trace-stage-body">{children}</div>
    </details>
  );
}

function SemanticStatus({ semantic }) {
  const detail = semantic?.reason;
  const detailText = detail ? ({
    embedding_cache_missing: 'Prepare the local embedding cache to enable semantic search.',
    semantic_not_configured: 'The local model is not configured.',
    'embedding-cache-missing': 'Prepare the local embedding cache to enable semantic search.',
  }[detail] || label(detail)) : '';

  return (
    <div className="semantic-status" title={detailText || undefined}>
      <span className={`status-dot ${semantic?.available ? 'online' : 'offline'}`} />
      <div><strong>Semantic retrieval</strong>
        <small>{semantic?.available
          ? `Available${semantic.granularity ? ` · ${label(semantic.granularity)}-level` : ''}`
          : semantic ? 'Unavailable · Lexical search ready' : 'Availability unknown'}</small>
      </div>
    </div>
  );
}

function WeightTerms({ trace, exclusions, onTerm, disabled }) {
  const retrieval = trace.retrieval ?? trace;
  const weights = retrieval.termWeights ?? [];
  const context = trace.context?.included ?? [];
  const terms = context.filter(entry => entry.role !== 'query').map(entry => typeof entry === 'string' ? { term: entry } : entry);
  const inheritedWeights = weights.filter(entry => !entry.sources?.current && (entry.sources?.entity || entry.sources?.feedback || entry.sources?.history));
  const inherited = [...new Map([...inheritedWeights, ...terms].map(term => [term.term, term])).values()];
  const effective = retrieval.effectiveTerms ?? [];
  return (
    <>
      {weights.length > 0 ? (
        <dl className="weight-list">
          {weights.map(({ term, weight, sources, historyTurn }) => <div key={term}>
            <dt><code>{term}</code>{sources?.entity > 0 && <small>Topic</small>}{sources?.feedback > 0 && <small>Feedback</small>}{historyTurn && <small>History · turn {historyTurn.replace('turn_', '')}</small>}</dt>
            <dd>{numeric(weight, 2)}</dd>
          </div>)}
        </dl>
      ) : effective.length ? <div className="term-chips">{effective.map(term => <code key={term}>{term}</code>)}</div> : <p>Term weights are unavailable for this turn.</p>}
      {(inherited.length > 0 || exclusions.length > 0) && <>
        <h4>Inherited context</h4>
        <div className="term-chips">
          {inherited.filter(item => !exclusions.includes(item.term)).map(({ term, sourceTurn }) => (
            <button type="button" key={term} title={sourceTurn ? `Remove ${term} inherited from turn ${sourceTurn.replace('turn_', '')}` : `Remove ${term} from ranking preview`}
              disabled={disabled} onClick={() => onTerm(term)}><code>{term}</code><Icon name="close" size={13} /></button>
          ))}
          {exclusions.map(term => <button type="button" key={term} className="excluded" title={`Restore ${term}`} disabled={disabled}
            onClick={() => onTerm(term)}><code>{term}</code><Icon name="undo" size={13} /></button>)}
        </div>
        <p className="muted-note">Changes apply to a ranking preview for this question.</p>
      </>}
    </>
  );
}

function ScoreView({ doc, onClose }) {
  const breakdown = doc.breakdown;
  return (
    <div className="score-inspector">
      <button className="text-button" type="button" onClick={onClose}><Icon name="undo" size={16} /> Back to search trace</button>
      <h3>{doc.title}</h3>
      <div className="score-detail">
        <span>Final score</span><strong>{numeric(doc.score, 5)}</strong>
        <span>Raw score</span><strong>{numeric(breakdown?.rawScore, 5)}</strong>
        <span>Model</span><strong>{modelNames[breakdown?.scoringModel] ?? label(breakdown?.scoringModel)}</strong>
      </div>
      {breakdown ? <>
        {breakdown.paths?.length > 0 && <Stage icon="layers" title="Path contributions" open>
          <dl className="weight-list">
            {breakdown.paths.map((path, index) => <div key={index}><dt>{label(path.origin)} <small>rank {path.rank}</small></dt>
              <dd>{numeric(path.contribution, 5)}</dd></div>)}
          </dl>
        </Stage>}
        {breakdown.termContributions?.length > 0 && <Stage icon="target" title="Term contributions" open>
          <dl className="weight-list">
            {breakdown.termContributions.map(term => <div key={term.term}><dt><code>{term.term}</code></dt><dd>{numeric(term.contribution, 5)}</dd></div>)}
          </dl>
        </Stage>}
        <Stage icon="sliders" title="Ranking adjustments" open>
          <dl className="weight-list">
            <div><dt>Feedback adjustment</dt><dd>{numeric(breakdown.feedbackBoost, 5)}</dd></div>
            <div><dt>Diversity penalty</dt><dd>{numeric(breakdown.diversityPenalty, 5)}</dd></div>
            <div><dt>Pinned</dt><dd>{breakdown.pinned ? 'Yes' : 'No'}</dd></div>
            {breakdown.reranking && <>
              <div><dt>Rank before reranking</dt><dd>{breakdown.reranking.initialRank}</dd></div>
              <div><dt>Cross-encoder rank</dt><dd>{breakdown.reranking.neuralRank}</dd></div>
              <div><dt>Cross-encoder logit</dt><dd>{numeric(breakdown.reranking.logit, 3)}</dd></div>
            </>}
          </dl>
        </Stage>
      </> : <p className="muted-note">A score breakdown is unavailable for this passage.</p>}
    </div>
  );
}

function TraceTabs({ active, onTab }) {
  const buttons = useRef([]);
  function move(event, index) {
    const next = {
      ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length,
      ArrowDown: (index + 2) % tabs.length, ArrowUp: (index + 2) % tabs.length,
      Home: 0, End: tabs.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onTab(tabs[next].id);
    buttons.current[next]?.focus();
  }
  return (
    <div className="execution-tabs" role="tablist" aria-label="Trace stages">
      {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab"
        id={`execution-tab-${tab.id}`} aria-controls={`execution-panel-${tab.id}`}
        aria-selected={tab.id === active} tabIndex={tab.id === active ? 0 : -1}
        ref={element => { buttons.current[index] = element; }}
        onClick={() => onTab(tab.id)} onKeyDown={event => move(event, index)}>
        <Icon name={tab.icon} size={15} /><span>{tab.title}</span>
      </button>)}
    </div>
  );
}

function StatePanel({ decision, context, clarification, subjectLock }) {
  const action = typeof decision === 'string' ? decision : decision?.action;
  return <>
    <Stage icon="branch" title="Topic decision" open>
      {action && <span className="decision-label">{decisionNames[action] ?? label(action)}</span>}
      {decision?.topicTitle && <strong className="trace-topic">{decision.topicTitle}</strong>}
      {decision?.reason && <p>{decision.reason}</p>}
      {decision?.previousTopic && <p>Previously active · {decision.previousTopic}</p>}
      {Number.isInteger(context?.earlierTurns) && <p>{context.earlierTurns} earlier turns in this topic</p>}
      {clarification?.options?.length > 0 && <ul className="trace-mini-list">
        {clarification.options.map(option => <li key={option.id}>{option.title}</li>)}
      </ul>}
    </Stage>
    {subjectLock && <Stage icon="target" title="Topic constraint" open>
      <dl className="weight-list">
        <div><dt>Selected</dt><dd>{subjectLock.requested === 'hard' ? 'Hard lock' : 'Soft boost'}</dd></div>
        <div><dt>Applied</dt><dd>{({ hard: 'Hard lock', soft: 'Soft boost', none: 'Unrestricted' })[subjectLock.effective]}</dd></div>
        {subjectLock.rule && <div><dt>Scope</dt><dd>{subjectLock.rule}</dd></div>}
        {Number.isInteger(subjectLock.candidates) && <div><dt>Eligible passages</dt><dd>{count(subjectLock.candidates)}</dd></div>}
      </dl>
      <p>{subjectLock.reason}</p>
      {subjectLock.effective === 'hard' && <div className="term-chips">
        {subjectLock.terms.map(term => <code key={term}>{term}</code>)}
      </div>}
    </Stage>}
    {context?.subjectTerms && <Stage icon="layers" title="Conversation memory" open>
      {[
        ['Subject terms', context.subjectTerms], ['Previous aspects', context.previousAspects],
        ['Current aspects', context.aspects],
      ].map(([name, values]) => <div key={name}>
        <h4>{name}</h4>
        {values?.length ? <div className="term-chips">{values.map(value => <code key={value}>{value}</code>)}</div> : <p>None recorded</p>}
      </div>)}
    </Stage>}
    {decision?.candidates?.length > 0 && <Stage icon="target" title="Topic candidates" open>
      <dl className="weight-list">
        {decision.candidates.map(({ title, score }) => <div key={title}><dt>{title}</dt><dd>{numeric(score, 2)}</dd></div>)}
      </dl>
    </Stage>}
  </>;
}

function RewritePanel({ trace, retrieval, exclusions, onTerm, disabled }) {
  const phrases = retrieval.phraseMatches ?? [];
  return <>
    <Stage icon="layers" title="Weighted query rewrite" open>
      {retrieval.rawQuery && <blockquote className="trace-query">{retrieval.rawQuery}</blockquote>}
      <WeightTerms trace={trace} exclusions={exclusions} onTerm={onTerm} disabled={disabled} />
    </Stage>
    <Stage icon="search" title="Quoted phrase matching" open>
      {phrases.length ? <>
        <p>{count(retrieval.phraseEligibleCount)} passages match every quoted phrase before other filters.</p>
        {phrases.map(phrase => <div key={phrase.phrase} className="phrase-entry">
          <strong>“{phrase.phrase}”</strong>
          <p>{phrase.strategy} · {count(phrase.matchingDocCount)} matches from {count(phrase.candidates)} candidates</p>
          {phrase.examples?.length > 0 && <ul className="trace-mini-list">
            {phrase.examples.map(({ id, title }) => <li key={id}>{title} <code>{id}</code></li>)}
          </ul>}
        </div>)}
      </> : <p>Try <code>"James Webb Space Telescope"</code> to require that word sequence in each passage.</p>}
    </Stage>
  </>;
}

const auditVariants = {
  'without-topic': 'Topic terms',
  'without-history': 'Earlier aspects',
  'without-feedback': 'Feedback and pins',
};

function ContextAudit({ audit, onRun, onPreview, disabled, loading }) {
  const [selected, select] = useState('without-topic');
  const variant = audit?.variants.find(item => item.id === selected);
  const before = audit?.baseline.results ?? [];
  const after = variant?.results ?? [];
  const beforeRanks = new Map(before.map(({ docId }, index) => [docId, index + 1]));
  const afterRanks = new Map(after.map(({ docId }, index) => [docId, index + 1]));
  const shared = before.filter(({ docId }) => afterRanks.has(docId)).length;
  const rows = [...new Map([...after, ...before].map(row => [row.docId, row])).values()]
    .filter(({ docId }) => beforeRanks.get(docId) !== afterRanks.get(docId));
  return <Stage icon="compare" title="Context impact" open>
    <p>Replay the saved turn three ways, omitting one source at a time. Each replay uses the saved retrieval settings.</p>
    <button type="button" className="button compact method-trigger" onClick={onRun} disabled={disabled}>
      {loading ? 'Checking context…' : audit ? 'Run context check again' : 'Check context impact'}
    </button>
    {variant && <>
      <div className="method-options" aria-label="Context to omit">
        {Object.entries(auditVariants).map(([id, name]) => <button key={id} type="button"
          aria-pressed={id === selected} onClick={() => select(id)}>{name}</button>)}
      </div>
      <p>{shared} passages shared in the top five · {audit.baseline.total} → {variant.total} results</p>
      {rows.length ? <table className="trace-table context-impact-table">
        <thead><tr><th>Passage</th><th>Saved</th><th>Without</th></tr></thead>
        <tbody>{rows.map(({ docId, title, snippet }) => <tr key={docId}>
          <th scope="row"><details className="changed-passage"><summary>{title}</summary><p>{snippet}</p></details></th>
          <td>{beforeRanks.get(docId) ?? '—'}</td><td>{afterRanks.get(docId) ?? '—'}</td>
        </tr>)}</tbody>
      </table> : <p>The top five passages kept their positions.</p>}
      <button type="button" className="button compact method-trigger" disabled={disabled} onClick={() => onPreview(selected)}>Preview this variant</button>
    </>}
  </Stage>;
}

function MethodsPanel({ methods, onCompareMethods, disabled, comparingMethods }) {
  const [chosenModel, selectModel] = useState('hybrid');
  const selected = methods?.comparisons?.find(method => method.model === chosenModel);
  const base = methods?.comparisons?.find(method => method.model === 'hybrid');
  const shared = new Set(base?.results.map(result => result.docId));
  return <Stage icon="compare" title="Compare retrieval methods" open>
    <p>Replay this saved question with the same conversation context and filters. Reranking and diversity are off for this comparison.</p>
    <button type="button" className="button compact method-trigger" disabled={disabled} onClick={onCompareMethods}>
      {comparingMethods ? 'Comparing methods…' : methods ? 'Run comparison again' : 'Compare methods'}
    </button>
    {methods && <>
      <div className="method-options" aria-label="Method results">
        {methods.comparisons.map(method => <button type="button" key={method.model} aria-pressed={method.model === chosenModel}
          onClick={() => selectModel(method.model)}>{formatModel(method.model)}</button>)}
      </div>
      {selected?.available ? <>
        <p>{formatModel(selected.effectiveModel)} · {numeric(selected.elapsedMs, 0)} ms
          {chosenModel !== 'hybrid' && ` · ${selected.results.filter(result => shared.has(result.docId)).length} of the first five shared with Hybrid`}
        </p>
        {selected.results.length ? <ol className="method-ranking">
          {selected.results.map(result => <li key={result.docId}>{result.title}</li>)}
        </ol> : <p>No passages returned.</p>}
      </> : <p>{selected?.reason ?? 'This method is unavailable.'}</p>}
    </>}
  </Stage>;
}

function PostingsPanel({ retrieval, ...methodProps }) {
  const fusion = retrieval.fusion;
  const reranking = retrieval.reranking;
  const model = retrieval.effectiveModel ?? retrieval.model;
  return <>
    <Stage icon="chart" title="Ranking paths & fusion" open>
      {fusion && <p>{fusion.method} · {count(fusion.fusedCount)} distinct candidates · {count(fusion.overlapCount)} from multiple paths</p>}
      {fusion?.method === 'Weighted reciprocal rank fusion' && <p><code>weight / ({fusion.rrfConstant} + rank)</code> per contributing path</p>}
      {retrieval.paths?.length ? retrieval.paths.map((path, index) => (
        <details className="trace-path" key={`${path.origin}-${path.model}-${index}`}>
          <summary><strong>{formatModel(path.model)}</strong><span>{label(path.origin)} · {count(path.candidates)} candidates</span></summary>
          <p>{count(path.scored)} passages scored · weight {numeric(path.weight, 2)}</p>
          <ol className="method-ranking">
            {path.leaders?.slice(0, 5).map(({ docId, title, score }) => <li key={docId}>{title} <code>{numeric(score, 3)}</code></li>)}
          </ol>
        </details>
      )) : <p>No ranking paths were recorded.</p>}
      {retrieval.filters?.domain && <p>Domain · {domainNames[retrieval.filters.domain] ?? label(retrieval.filters.domain)}</p>}
      {retrieval.requestedModel && model && retrieval.requestedModel !== model &&
        <p>{formatModel(retrieval.requestedModel)} requested · {formatModel(model)} used</p>}
    </Stage>
    <Stage icon="layers" title="Inverted index postings" open>
      {retrieval.postings?.length ? <table className="trace-table">
        <thead><tr><th>Term</th><th>Passages (DF)</th><th>BM25 IDF</th></tr></thead>
        <tbody>{retrieval.postings.map(({ term, df, idf }) => (
          <tr key={term}><th scope="row"><code>{term}</code></th><td>{count(df)}</td><td>{numeric(idf, 3)}</td></tr>
        ))}</tbody>
      </table> : <p>No posting lists were available for this question.</p>}
    </Stage>
    {reranking?.policy && reranking.policy !== 'off' && <Stage icon="sliders" title="Passage reranking" open>
      <p>{reranking.available
        ? `${label(reranking.policy)} · ${reranking.evaluated} passages scored in ${reranking.elapsedMs} ms`
        : reranking.reason}</p>
      {reranking.policy === 'adaptive' && reranking.depth && <p>
        Lexical and semantic rankings shared {reranking.agreement} of their first eight passages. Candidate depth: {reranking.depth}.
      </p>}
    </Stage>}
    <MethodsPanel {...methodProps} />
  </>;
}

const phaseLabels = {
  routing: 'Topic routing', queryPreparation: 'Rewrite & phrase matching', lexicalScoring: 'Lexical scoring',
  semanticSearch: 'Semantic search', fusion: 'Rank fusion', reranking: 'Passage reranking',
  diversity: 'Diversity pass', evidenceSnippets: 'Evidence snippets',
};

function ProfilePanel({ novelty, timings, questionOnly }) {
  const phases = Object.entries(phaseLabels).filter(([id]) => Number.isFinite(timings?.[id]));
  const maxTime = Math.max(1, ...phases.map(([id]) => timings[id]));
  return <>
    <Stage icon="bookmark" title="Novelty & feedback" open>
      {novelty ? <>
        <div className="trace-novelty-stats">
          {[['New passages', novelty.newPassages], ['Seen again', novelty.repeated], ['Distinct articles', novelty.distinctArticles]].map(([title, value]) => (
            <div key={title}><strong>{count(value)}</strong><span>{title}</span></div>
          ))}
        </div>
        <p>{questionOnly ? 'This preview ignores conversation history.' : `${count(novelty.seenBefore)} unique passages were shown before this question in the same topic.`}</p>
        <dl className="weight-list">
          <div><dt>Diversity pass</dt><dd>{novelty.diversity ? 'On' : 'Off'}</dd></div>
          <div><dt>Relevant examples</dt><dd>{count(novelty.relevant)}</dd></div>
          <div><dt>Hidden by feedback</dt><dd>{count(novelty.hidden)}</dd></div>
          <div><dt>Pinned candidates</dt><dd>{count(novelty.pinned)}</dd></div>
        </dl>
      </> : <p>Search results are needed to compute novelty.</p>}
    </Stage>
    <Stage icon="clock" title="Turn latency profiler" open>
      {Number.isFinite(timings?.totalMs) && <div className="trace-total"><span>Total processing time</span><strong>{numeric(timings.totalMs, 1)} ms</strong></div>}
      {phases.length ? <ul className="profile-bars">
        {phases.map(([id, name]) => <li key={id}>
          <div><span>{name}</span><code>{numeric(timings[id], 1)} ms</code></div>
          <span className="profile-track" aria-hidden="true"><i style={{ width: `${timings[id] / maxTime * 100}%` }} /></span>
        </li>)}
      </ul> : <p>No retrieval stages have run for this turn.</p>}
    </Stage>
  </>;
}

export default function WorkspaceInspector({ trace, semantic, doc, exclusions, disabled, onTerm, onCloseDoc, onClose, clarification, methods, onCompareMethods, comparingMethods, active, setActive, contextAudit, onRunContextAudit, onPreviewVariant, auditingContext }) {
  const retrieval = trace?.retrieval ?? trace;
  const model = retrieval?.effectiveModel ?? retrieval?.model;
  const elapsed = trace?.timings?.totalMs;
  return (
    <>
      <div className="inspector-header">
        <span className="pane-icon"><Icon name="trace" size={21} /></span>
        <div><h2>IR Execution Trace</h2><p>Inspect how this search ran</p></div>
        <button className="icon-button close-panel" type="button" aria-label="Close trace inspector" onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      {!doc && <TraceTabs active={active} onTab={setActive} />}
      <div className="inspector-content">
        {doc ? <ScoreView doc={doc} onClose={onCloseDoc} /> : <section role="tabpanel" id={`execution-panel-${active}`} aria-labelledby={`execution-tab-${active}`} tabIndex={0}>
          {!trace ? <Empty icon="trace" title="No search to inspect" className="inspector-empty">
            <p>Run a search to see its decision, positional matches, ranking paths, and processing time.</p>
          </Empty> : <>
            {(model || Number.isFinite(elapsed) || Number.isInteger(retrieval.returnedCount)) && <div className="trace-meta">
              {model && <span className="count-tag"><Icon name="layers" size={14} />{formatModel(model)}</span>}
              {Number.isFinite(elapsed) && <span className="count-tag"><Icon name="clock" size={14} />{numeric(elapsed, 0)} ms</span>}
              {Number.isInteger(retrieval.returnedCount) && <span className="count-tag">{count(retrieval.returnedCount)} results</span>}
            </div>}
            {active === 'state' && <StatePanel decision={trace.decision} context={trace.context} clarification={clarification} subjectLock={retrieval.subjectLock} />}
            {active === 'rewrite' && <>
              <RewritePanel trace={trace} retrieval={retrieval} exclusions={exclusions} onTerm={onTerm} disabled={disabled} />
              <ContextAudit audit={contextAudit} onRun={onRunContextAudit} onPreview={onPreviewVariant} disabled={disabled} loading={auditingContext} />
            </>}
            {active === 'postings' && <PostingsPanel retrieval={retrieval} methods={methods} onCompareMethods={onCompareMethods} disabled={disabled} comparingMethods={comparingMethods} />}
            {active === 'profile' && <>
              <ProfilePanel novelty={retrieval.novelty} timings={trace.timings} questionOnly={trace.questionOnly} />
              <details className="trace-details raw-trace"><summary>Raw trace JSON</summary><pre>{JSON.stringify(trace, null, 2)}</pre></details>
            </>}
          </>}
        </section>}
      </div>
      <SemanticStatus semantic={retrieval?.semantic ?? semantic} />
    </>
  );
}
