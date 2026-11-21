import React, { useEffect, useState } from 'react';
import { Empty, Icon, label, numeric, Status } from '../ui.jsx';

function RankingList({ title, icon, results, accent }) {
  return (
    <section className={`ranking-list ${accent ? 'accent' : ''}`}>
      <div className="ranking-header"><span className="empty-icon"><Icon name={icon} size={21} /></span>
        <div><h2>{title}</h2><p>{results.length} passages</p></div>
      </div>
      {results.length > 0 ? (
        <ol>
          {results.map((result, index) => (
            <li key={result.docId} className="ranking-item">
              <span className="rank-index">{String(index + 1).padStart(2, '0')}</span>
              <div><h3>{result.title}</h3>
                <p>{result.snippet || (result.body?.length > 210 ? `${result.body.slice(0, 210)}…` : result.body)}</p></div>
              <code>{numeric(result.score)}</code>
            </li>
          ))}
        </ol>
      ) : <p className="ranking-empty">No matching passages.</p>}
    </section>
  );
}

function RankChanges({ baseline, final }) {
  const finalRanks = new Map(final.map((doc, index) => [doc.docId, index + 1]));
  const baselineRanks = new Map(baseline.map((doc, index) => [doc.docId, index + 1]));
  const titles = new Map([...baseline, ...final].map(doc => [doc.docId, doc.title]));
  const changes = Array.from(titles, ([id, title]) => ({
    id, title, before: baselineRanks.get(id), after: finalRanks.get(id),
  })).filter(({ before, after }) => before !== after);
  if (changes.length === 0) return null;

  return (
    <section className="rank-changes report-card">
      <h2>Rank movement</h2>
      <div className="data-table-wrap">
        <table className="data-table"><thead><tr><th>Passage</th><th>Midterm rank</th><th>TurnTrace 2 rank</th><th>Change</th></tr></thead>
          <tbody>{changes.map(({ id, title, before, after }) => (
            <tr key={id}><th scope="row">{title}</th><td>{before ?? '—'}</td><td>{after ?? '—'}</td>
              <td>{before == null ? <span className="movement positive">Added</span> : after == null ? <span className="movement negative">Dropped</span>
                : <span className={`movement ${before > after ? 'positive' : 'negative'}`}>{before > after ? '↑' : '↓'} {Math.abs(before - after)}</span>}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

export function CompareView({ preset, comparison, busy, onCompare }) {
  const [mode, setMode] = useState('ranking');
  const [query, setQuery] = useState(preset ?? '');
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  useEffect(() => { setQuery(preset ?? ''); }, [preset]);

  const baseline = comparison?.baseline?.results ?? [];
  const final = comparison?.final?.results ?? [];
  const subjects = comparison?.subjects ?? [];
  const hasResults = mode === 'subjects' ? subjects.length > 0 : Boolean(comparison?.baseline && comparison?.final);

  return (
    <div className="research-page">
      <div className="research-heading"><span className="empty-icon"><Icon name="compare" size={23} /></span>
        <div><h1>Compare evidence</h1><p>Inspect changes in ranking or retrieve evidence for two subjects side by side.</p></div>
      </div>
      <div className="switch-group" aria-label="Comparison mode">
        <button type="button" aria-pressed={mode === 'ranking'} onClick={() => setMode('ranking')}>Rankings</button>
        <button type="button" aria-pressed={mode === 'subjects'} onClick={() => setMode('subjects')}>Two subjects</button>
      </div>
      <form className="compare-form" onSubmit={event => {
        event.preventDefault();
        if (mode === 'subjects') {
          if (first.trim() && second.trim()) onCompare(query.trim(), [first.trim(), second.trim()]);
        } else if (query.trim()) onCompare(query.trim());
      }}>
        <label><span>{mode === 'subjects' ? 'Focus question (optional)' : 'Search question'}</span>
          <input disabled={busy} value={query} maxLength={2000} onChange={event => setQuery(event.target.value)} placeholder={mode === 'subjects' ? 'e.g. infrared instruments' : 'e.g. What instruments does JWST carry?'} />
        </label>
        {mode === 'subjects' && <div className="subject-inputs">
          <label><span>First subject</span><input disabled={busy} value={first} maxLength={100} onChange={event => setFirst(event.target.value)} placeholder="e.g. James Webb Space Telescope" /></label>
          <label><span>Second subject</span><input disabled={busy} value={second} maxLength={100} onChange={event => setSecond(event.target.value)} placeholder="e.g. Hubble Space Telescope" /></label>
        </div>}
        <button className="button primary" type="submit" disabled={busy || (mode === 'ranking' ? !query.trim() : !first.trim() || !second.trim())}>
          <Icon name="compare" size={18} /> {busy ? 'Comparing…' : mode === 'ranking' ? 'Compare rankings' : 'Compare subjects'}
        </button>
      </form>
      {busy && <Status kind="loading">Retrieving comparable evidence…</Status>}
      {!busy && !hasResults && <Empty icon="compare" title="No comparison selected"><p>Run a comparison to see both sets of ranked passages here.</p></Empty>}
      {!busy && hasResults && mode === 'ranking' && <>
        {comparison.query && <p className="comparison-query">Rankings for <strong>{comparison.query}</strong></p>}
        <div className="comparison-grid">
          <RankingList title="Midterm baseline" icon="clock" results={baseline} />
          <RankingList title="TurnTrace 2" icon="trace" accent results={final} />
        </div>
        <RankChanges baseline={baseline} final={final} />
      </>}
      {!busy && hasResults && mode === 'subjects' && <div className="comparison-grid">
        {subjects.map((subject, index) => <RankingList key={`${subject.subject}-${index}`} title={subject.subject} icon={index === 0 ? 'target' : 'layers'} accent={index === 1} results={subject.results ?? []} />)}
      </div>}
    </div>
  );
}

const metricDefinitions = [
  ['p5', 'Precision@5'],
  ['p10', 'Precision@10'],
  ['ndcg10', 'nDCG@10'],
  ['mrr20', 'MRR@20'],
  ['knownRecall20', 'Known recall@20'],
  ['unjudged10', 'Unjudged@10'],
];

function EvaluationChart({ systems }) {
  return (
    <section className="report-card metric-card">
      <h2>Same-turn retrieval metrics</h2>
      <p>Macro-averages across evaluated turns. Unjudged@10 is the share of returned results without a recorded judgment.</p>
      <div className="chart-legend">{systems.map((system, index) => <span key={system.id}><i className={`series-${index % 3}`} />{system.label ?? label(system.id)}</span>)}</div>
      <div className="metric-chart">
        {metricDefinitions.map(([key, name]) => (
          systems.some(system => Number.isFinite(system.metrics?.[key])) && <div className="metric-group" key={key}>
            <h3>{name}</h3>
            <div className="metric-bars">{systems.map((system, index) => {
              const value = system.metrics?.[key];
              if (!Number.isFinite(value)) return null;
              return <div className="metric-bar-row" key={system.id}>
                <div className="bar-track"><div className={`bar series-${index % 3}`} role="img"
                  aria-label={`${system.label ?? label(system.id)} ${name}: ${numeric(value)}`}
                  style={{ width: `${Math.max(0, Math.min(value, 1)) * 100}%` }} /></div>
                <code>{numeric(value)}</code>
              </div>;
            })}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

const count = value => Number.isFinite(value) ? value.toLocaleString() : '—';

export function ExperimentsView({ evaluation, error, onReload }) {
  const report = evaluation?.summary && typeof evaluation.summary === 'object' ? evaluation.summary : evaluation;
  const systems = Array.isArray(report?.systems) ? report.systems : [];
  const coverage = report?.judgments ?? report?.coverage;
  const behavior = report?.behavior;
  const available = !!report && evaluation?.available !== false && (systems.length > 0 || !!behavior || !!coverage);

  return (
    <div className="research-page">
      <div className="research-heading"><span className="empty-icon"><Icon name="chart" size={23} /></span>
        <div><h1>Experiments</h1><p>Retrieval metrics, judgment coverage, and checks of conversational behavior.</p></div>
        <button className="button compact" type="button" onClick={onReload} disabled={!report && !error}><Icon name="reset" size={16} /> Refresh</button>
      </div>
      {error ? <Status kind="error">{error}</Status> : !report ? <Status kind="loading">Loading the evaluation report…</Status> :
        !available ? <Empty icon="chart" title="Evaluation report unavailable">
          <p>{typeof evaluation?.message === 'string' ? evaluation.message : 'Run the v3 evaluation to generate measured results for this workspace.'}</p>
        </Empty> : <>
          <div className="report-stats">
            {[
              ['Evaluated turns', report.turnCount],
              ['Conversations', report.conversationCount],
              ['Judged pairs', coverage?.judgedPairs],
              ['Behavior checks', behavior && Number.isFinite(behavior.total) ? `${behavior.passed} / ${behavior.total}` : undefined],
            ].filter(([, value]) => value != null).map(([title, value]) =>
              <div key={title}><span>{title}</span><strong>{typeof value === 'number' ? count(value) : value}</strong></div>)}
          </div>
          {systems.some(system => metricDefinitions.some(([key]) => Number.isFinite(system.metrics?.[key]))) && <EvaluationChart systems={systems} />}
          {coverage && <section className="report-card">
            <h2>Judgment coverage</h2>
            <p>{coverage.provenance || 'Relevance judgment provenance was not included.'}
              {coverage.humanValidated === false && ' Human validation is pending.'}
              {report.split && ` Results use the ${report.split} split.`}
            </p>
            <dl className="coverage-stats">
              <div><dt>Turns with judgments</dt><dd>{count(coverage.judgedTurns)}</dd></div>
              <div><dt>Turns missing judgments</dt><dd>{count(coverage.missingTurnIds?.length)}</dd></div>
              <div><dt>No positive judgment</dt><dd>{count(coverage.turnsWithoutPositiveJudgment)}</dd></div>
              <div><dt>Pairs to pool</dt><dd>{count(report.pooling?.pairs)}</dd></div>
            </dl>
            {systems.some(system => system.coverage) && <div className="data-table-wrap">
              <table className="data-table"><thead><tr><th>System</th><th>Returned @10</th><th>Judged @10</th><th>Unjudged @10</th></tr></thead>
                <tbody>{systems.map(system => <tr key={system.id}><th scope="row">{system.label ?? label(system.id)}</th>
                  <td>{count(system.coverage?.retrievedAt10)}</td><td>{count(system.coverage?.judgedAt10)}</td><td>{count(system.coverage?.unjudgedAt10)}</td></tr>)}</tbody>
              </table>
            </div>}
            {coverage.missingTurnIds?.length > 0 && <details className="trace-details"><summary>View missing turn IDs</summary><p>{coverage.missingTurnIds.join(', ')}</p></details>}
          </section>}
          {behavior && <section className="report-card">
            <h2>Conversational behavior</h2>
            <p>Synthetic cases exercise topic resumption, clarification, and ranking feedback.</p>
            <ul className="behavior-list">
              {behavior.cases?.map(test => <li key={test.id}><Icon name={test.passed ? 'check' : 'alert'} size={17} />
                <strong>{test.title ?? label(test.id)}</strong><span className={test.passed ? 'positive' : 'negative'}>{test.passed ? 'Pass' : 'Fail'}</span></li>)}
            </ul>
          </section>}
          {report.artifacts && <div className="report-downloads" aria-label="Evaluation downloads">
            <a className="button compact" href="/api/v3/evaluation/summary.json" download><Icon name="download" size={15} /> Summary JSON</a>
            {report.artifacts.perTurn && <a className="button compact" href="/api/v3/evaluation/per_turn.csv" download><Icon name="download" size={15} /> Per-turn results</a>}
            {report.artifacts.unjudgedPool && <a className="button compact" href="/api/v3/evaluation/unjudged_pool.csv" download><Icon name="download" size={15} /> Unjudged pool</a>}
          </div>}
        </>}
    </div>
  );
}
