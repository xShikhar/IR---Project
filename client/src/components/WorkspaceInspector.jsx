import React from 'react';
import { Empty, Icon, domainNames, label, modelNames, numeric } from '../ui.jsx';

const decisionNames = { CREATE: 'New topic', CONTINUE: 'Continue topic', RESUME: 'Resume topic', CLARIFY: 'Clarification needed' };
const stages = [
  { icon: 'branch', title: 'Topic decision', body: 'See which topic the question was assigned to.' },
  { icon: 'layers', title: 'Query terms', body: 'Inspect term weights and remove inherited context.' },
  { icon: 'chart', title: 'Ranking paths', body: 'See which retrieval models contributed evidence.' },
];

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

export default function WorkspaceInspector({ trace, semantic, doc, exclusions, disabled, onTerm, onCloseDoc, onClose }) {
  const decision = trace?.decision;
  const action = typeof decision === 'string' ? decision : decision?.action;
  const retrieval = trace?.retrieval ?? trace;
  const model = retrieval?.effectiveModel ?? retrieval?.model;
  const filters = retrieval?.filters;
  const elapsed = trace?.timings?.totalMs;
  return (
    <>
      <div className="inspector-header">
        <span className="pane-icon"><Icon name="trace" size={21} /></span>
        <div><h2>Trace inspector</h2><p>How the search was resolved</p></div>
        <button className="icon-button close-panel" type="button" aria-label="Close trace inspector" onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      <div className="inspector-content">
        {doc ? <ScoreView doc={doc} onClose={onCloseDoc} /> : !trace ? <>
          <Empty icon="trace" title="No trace selected" className="inspector-empty">
            <p>Run a search to see how your query was interpreted and why passages ranked where they did.</p>
          </Empty>
          <ol className="stage-overview">
            {stages.map(stage => <li key={stage.title}><span className="stage-icon"><Icon name={stage.icon} size={17} /></span>
              <div><strong>{stage.title}</strong><p>{stage.body}</p></div></li>)}
          </ol>
        </> : <>
          <div className="trace-meta">
            {model && <span className="count-tag"><Icon name="layers" size={14} />{modelNames[model] ?? label(model)}</span>}
            {typeof elapsed === 'number' && <span className="count-tag"><Icon name="clock" size={14} />{numeric(elapsed, 0)} ms</span>}
          </div>
          <Stage icon="branch" title="Topic decision" open>
            {action && <span className="decision-label">{decisionNames[action] ?? label(action)}</span>}
            {decision?.topicTitle && <strong className="trace-topic">{decision.topicTitle}</strong>}
            {decision?.reason && <p>{decision.reason}</p>}
            {decision?.candidates?.length > 0 && <details className="trace-details">
              <summary>Topic candidates</summary>
              <pre>{JSON.stringify(decision.candidates, null, 2)}</pre>
            </details>}
          </Stage>
          <Stage icon="layers" title="Query terms" open>
            <WeightTerms trace={trace} exclusions={exclusions} onTerm={onTerm} disabled={disabled} />
          </Stage>
          <Stage icon="chart" title="Ranking paths" open>
            {retrieval?.paths?.length > 0 ? <dl className="weight-list">
              {retrieval.paths.map((path, index) => <div key={index}><dt>{label(path.origin)} <small>{modelNames[path.model] ?? label(path.model)}</small></dt>
                <dd>{path.candidates ?? '—'}</dd></div>)}
            </dl> : <p>Ranking paths are unavailable for this turn.</p>}
            {filters?.domain && <p>Domain filter · {domainNames[filters.domain] ?? label(filters.domain)}</p>}
            {retrieval?.reranking?.policy && retrieval.reranking.policy !== 'off' && <div>
              <h4>Passage reranking</h4>
              <p>{retrieval.reranking.available
                ? `${label(retrieval.reranking.policy)} · ${retrieval.reranking.evaluated} passages scored in ${retrieval.reranking.elapsedMs} ms`
                : retrieval.reranking.reason}</p>
              {retrieval.reranking.policy === 'adaptive' && retrieval.reranking.depth && <p>
                Lexical and semantic rankings shared {retrieval.reranking.agreement} of their first eight passages. Candidate depth: {retrieval.reranking.depth}.
              </p>}
            </div>}
            {retrieval?.requestedModel && model && retrieval.requestedModel !== model &&
              <p>{modelNames[retrieval.requestedModel] ?? label(retrieval.requestedModel)} requested · {modelNames[model] ?? label(model)} used</p>}
          </Stage>
          <details className="trace-details raw-trace"><summary>Raw trace JSON</summary><pre>{JSON.stringify(trace, null, 2)}</pre></details>
        </>}
      </div>
      <SemanticStatus semantic={retrieval?.semantic ?? semantic} />
    </>
  );
}
