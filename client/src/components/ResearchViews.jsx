import React, { useEffect, useState } from 'react';
import { Empty, Icon, label, numeric, Status } from '../ui.jsx';

function RankingList({ title, icon, results, accent, context = [] }) {
  return (
    <section className={`ranking-list ${accent ? 'accent' : ''}`}>
      <div className="ranking-header"><span className="empty-icon"><Icon name={icon} size={21} /></span>
        <div><h2>{title}</h2><p>{results.length} passages</p></div>
      </div>
      {context.length > 0 && <dl className="comparison-context">{context.map(([name, value]) => (
        <React.Fragment key={name}><dt>{name}</dt><dd>{value}</dd></React.Fragment>
      ))}</dl>}
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

function RankChanges({ baseline, final, relevance }) {
  const finalRanks = new Map(final.map((doc, index) => [doc.docId, index + 1]));
  const baselineRanks = new Map(baseline.map((doc, index) => [doc.docId, index + 1]));
  const documents = new Map([...baseline, ...final].map(doc => [doc.docId, doc]));
  const changes = Array.from(documents, ([id, document]) => ({
    id, document, before: baselineRanks.get(id), after: finalRanks.get(id),
  })).filter(({ before, after }) => before !== after).sort((a, b) =>
    Math.min(a.before ?? Infinity, a.after ?? Infinity) - Math.min(b.before ?? Infinity, b.after ?? Infinity)
  );
  const shared = baseline.filter(doc => finalRanks.has(doc.docId)).length;
  const grades = ['Irrelevant', 'Useful context', 'Direct answer'];

  return (
    <section className="rank-changes report-card">
      <h2>Rank movement</h2>
      <p className="rank-movement-note">Expand a passage to read its text. Position alone does not establish relevance.</p>
      <dl className="rank-summary">
        <div><dt>Shared passages</dt><dd>{shared}</dd></div>
        <div><dt>Only in TurnTrace 2</dt><dd>{final.length - shared}</dd></div>
        <div><dt>Only in midterm</dt><dd>{baseline.length - shared}</dd></div>
      </dl>
      <div className="data-table-wrap">
        {changes.length ? <table className="data-table"><thead><tr><th>Passage</th><th>Midterm rank</th><th>TurnTrace 2 rank</th><th>Movement</th>{relevance && <th>Relevance grade</th>}</tr></thead>
          <tbody>{changes.map(({ id, document, before, after }) => (
            <tr key={id}><th scope="row"><details className="changed-passage">
              <summary>{document.title}</summary><p>{document.body ?? document.snippet}</p>
            </details></th><td>{before ?? '—'}</td><td>{after ?? '—'}</td>
              <td><span className="rank-neutral">{before == null ? 'Entered results' : after == null ? 'Left results'
                : `${before > after ? '↑' : '↓'} ${Math.abs(before - after)}`}</span></td>
              {relevance && <td>{grades[relevance.grades[id]] ?? 'Unjudged'}</td>}</tr>
          ))}</tbody>
        </table> : <p className="rank-movement-note">The returned passages occupy the same positions.</p>}
      </div>
    </section>
  );
}

function RelevanceSummary({ relevance }) {
  if (!relevance) return <div className="comparison-evidence-note">
    <Icon name="info" size={17} /><span>There are no reference grades for this replay. Use a benchmark question to compare measured relevance.</span>
  </div>;
  const { baseline, final, source } = relevance;
  return <section className="report-card comparison-relevance">
    <h2>Measured relevance for this question</h2>
    <p>{source}. Scores use the available grades, and unjudged passages receive zero gain in nDCG.</p>
    <table className="data-table"><thead><tr><th>Measure</th><th>Midterm</th><th>TurnTrace 2</th></tr></thead>
      <tbody>
        <tr><th scope="row">nDCG@10</th><td>{numeric(baseline.ndcg10, 4)}</td><td>{numeric(final.ndcg10, 4)}</td></tr>
        <tr><th scope="row">Precision@10</th><td>{numeric(baseline.p10, 4)}</td><td>{numeric(final.p10, 4)}</td></tr>
        <tr><th scope="row">Judged passages</th><td>{baseline.judgedAt10} of {baseline.retrievedAt10}</td><td>{final.judgedAt10} of {final.retrievedAt10}</td></tr>
      </tbody></table>
  </section>;
}

export function CompareView({ preset, comparison, busy, onCompare, loadBenchmarks }) {
  const [mode, setMode] = useState('ranking');
  const [query, setQuery] = useState(preset ?? '');
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [benchmarkId, setBenchmarkId] = useState('');
  const [benchmarkRerank, setBenchmarkRerank] = useState('off');
  const [benchmarks, setBenchmarks] = useState(null);
  const [benchmarkError, setBenchmarkError] = useState('');
  const [customMidterm, setCustomMidterm] = useState(false);
  const [midterm, setMidterm] = useState({
    model: 'cosine', lockMode: 'hard',
    useChampionLists: false, applyIndexElimination: false, applySeenPenalty: true,
  });
  useEffect(() => { setQuery(preset ?? ''); }, [preset]);
  useEffect(() => {
    if (mode !== 'benchmark') return;
    const controller = new AbortController();
    loadBenchmarks(controller.signal).then(setBenchmarks).catch(error => {
      if (!controller.signal.aborted) setBenchmarkError(error.message);
    });
    return () => controller.abort();
  }, [mode, loadBenchmarks]);

  const baseline = comparison?.baseline?.results ?? [];
  const final = comparison?.final?.results ?? [];
  const subjects = comparison?.subjects ?? [];
  const baselineTrace = comparison?.baseline?.trace;
  const finalTrace = comparison?.final?.trace;
  const isRanking = mode !== 'subjects';
  const isBenchmark = mode === 'benchmark';
  const hasRankings = Boolean(comparison?.baseline && comparison?.final && Boolean(comparison?.replay?.benchmarkId) === isBenchmark);
  const hasResults = isRanking ? hasRankings && !comparison?.subjects : subjects.length > 0;

  return (
    <div className="research-page">
      <div className="research-heading"><span className="empty-icon"><Icon name="compare" size={23} /></span>
        <div><h1>Compare evidence</h1><p>Inspect changes in ranking or retrieve evidence for two subjects side by side.</p></div>
      </div>
      <div className="switch-group" aria-label="Comparison mode">
        <button type="button" aria-pressed={mode === 'ranking'} onClick={() => setMode('ranking')}>Rankings</button>
        <button type="button" aria-pressed={isBenchmark} onClick={() => setMode('benchmark')}>Benchmark relevance</button>
        <button type="button" aria-pressed={mode === 'subjects'} onClick={() => setMode('subjects')}>Two subjects</button>
      </div>
      <form className="compare-form" onSubmit={event => {
        event.preventDefault();
        if (mode === 'subjects') {
          if (first.trim() && second.trim()) onCompare(query.trim(), [first.trim(), second.trim()]);
        } else if (isBenchmark) {
          if (benchmarkId) onCompare('', undefined, undefined, benchmarkId, benchmarkRerank);
        } else if (query.trim()) onCompare(query.trim(), undefined, customMidterm ? midterm : undefined);
      }}>
        {isBenchmark ? <label><span>Benchmark question</span>
          <select value={benchmarkId} disabled={busy || !benchmarks?.length} onChange={event => setBenchmarkId(event.target.value)}>
            <option value="">{benchmarks ? 'Choose a graded TEST question' : 'Loading benchmark questions…'}</option>
            {benchmarks?.map(turn => <option key={turn.id} value={turn.id}>{turn.topic} · {turn.query}</option>)}
          </select>
        </label> : <label><span>{mode === 'subjects' ? 'Focus question (optional)' : 'Search question'}</span>
          <input disabled={busy} value={query} maxLength={2000} onChange={event => setQuery(event.target.value)} placeholder={mode === 'subjects' ? 'e.g. infrared instruments' : 'e.g. What instruments does JWST carry?'} />
        </label>}
        {isBenchmark && <label><span>TurnTrace 2 reranking</span>
          <select value={benchmarkRerank} disabled={busy} onChange={event => setBenchmarkRerank(event.target.value)}>
            <option value="off">Off</option><option value="fixed">Fixed depth</option><option value="adaptive">Adaptive depth</option>
          </select>
        </label>}
        {mode === 'subjects' && <div className="subject-inputs">
          <label><span>First subject</span><input disabled={busy} value={first} maxLength={100} onChange={event => setFirst(event.target.value)} placeholder="e.g. James Webb Space Telescope" /></label>
          <label><span>Second subject</span><input disabled={busy} value={second} maxLength={100} onChange={event => setSecond(event.target.value)} placeholder="e.g. Hubble Space Telescope" /></label>
        </div>}
        {mode === 'ranking' && <details className="legacy-settings">
          <summary>Midterm retrieval controls</summary>
          <label className="legacy-check"><input type="checkbox" checked={customMidterm} disabled={busy}
            onChange={event => setCustomMidterm(event.target.checked)} /> Customize the midterm run</label>
          {customMidterm && <div className="legacy-options">
            <label><span>Midterm model</span><select value={midterm.model} disabled={busy} onChange={event => setMidterm({ ...midterm, model: event.target.value })}>
              <option value="cosine">SMART cosine</option><option value="bm25">BM25</option>
            </select></label>
            <label><span>Entity lock</span><select value={midterm.lockMode} disabled={busy} onChange={event => setMidterm({ ...midterm, lockMode: event.target.value })}>
              <option value="hard">Hard</option><option value="soft">Soft</option>
            </select></label>
            {[
              ['useChampionLists', 'Champion lists'],
              ['applyIndexElimination', 'Index elimination'],
              ['applySeenPenalty', 'Seen-passage penalty'],
            ].map(([key, title]) => <label key={key} className="legacy-check">
              <input type="checkbox" checked={midterm[key]} disabled={busy}
                onChange={event => setMidterm({ ...midterm, [key]: event.target.checked })} /> {title}
            </label>)}
          </div>}
        </details>}
        <button className="button primary" type="submit" disabled={busy || (isBenchmark ? !benchmarkId : isRanking ? !query.trim() : !first.trim() || !second.trim())}>
          <Icon name="compare" size={18} /> {busy ? 'Comparing…' : isBenchmark ? 'Run benchmark replay' : isRanking ? 'Compare rankings' : 'Compare subjects'}
        </button>
      </form>
      {isBenchmark && benchmarkError && <Status kind="error">{benchmarkError}</Status>}
      {busy && <Status kind="loading">Retrieving comparable evidence…</Status>}
      {!busy && !hasResults && <Empty icon="compare" title="No comparison selected"><p>Run a comparison to see both sets of ranked passages here.</p></Empty>}
      {!busy && hasResults && isRanking && <>
        {comparison.query && <p className="comparison-query">Rankings for <strong>{comparison.query}</strong></p>}
        {comparison.replay && <p className="comparison-query">
          {comparison.replay.benchmarkId ? `Replayed benchmark turn ${comparison.replay.priorTurnCount + 1}` : comparison.replay.turnId
            ? `Replayed turn ${comparison.replay.priorTurnCount + 1}`
            : 'Compared a new question'}
          {' · '}{comparison.replay.priorTurnCount} earlier {comparison.replay.priorTurnCount === 1 ? 'turn' : 'turns'} supplied to both engines
        </p>}
        <RelevanceSummary relevance={comparison.relevance} />
        {comparison.replay?.benchmarkId && comparison.replay.rerank !== 'off' && <p className="comparison-query">
          {finalTrace?.reranking?.available
            ? `${label(comparison.replay.rerank)} reranking scored ${finalTrace.reranking.evaluated} passages for this question.`
            : finalTrace?.reranking?.reason ?? 'No passage reranking ran for this question.'}
        </p>}
        <div className="comparison-grid">
          <RankingList title="Midterm baseline" icon="clock" results={baseline} context={[
            ['Topic decision', label(baselineTrace?.shiftDecision?.decision)],
            ['Rewritten query', baselineTrace?.rewriter?.rewrittenQuery],
          ].filter(([, value]) => value)} />
          <RankingList title="TurnTrace 2" icon="trace" accent results={final} context={[
            ['Topic decision', label(finalTrace?.decision?.action)],
            ['Active topic', finalTrace?.decision?.topicTitle],
            ['Weighted terms', finalTrace?.termWeights?.slice(0, 12).map(item => `${item.term} × ${numeric(item.weight, 2)}`).join(', ')],
          ].filter(([, value]) => value)} />
        </div>
        <RankChanges baseline={baseline} final={final} relevance={comparison.relevance} />
        {baselineTrace && <details className="report-card legacy-trace">
          <summary>Midterm IR Execution Trace</summary>
          <p>Original engine output for the replayed question, including phrase matches, postings, pruning, fusion, and timing.</p>
          <pre>{JSON.stringify(baselineTrace, null, 2)}</pre>
        </details>}
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
      <div className="chart-legend">{systems.map((system, index) => <span key={system.id}><i className={`series-${index % 5}`} />{system.label ?? label(system.id)}</span>)}</div>
      <div className="metric-chart">
        {metricDefinitions.map(([key, name]) => (
          systems.some(system => Number.isFinite(system.metrics?.[key])) && <div className="metric-group" key={key}>
            <h3>{name}</h3>
            <div className="metric-bars">{systems.map((system, index) => {
              const value = system.metrics?.[key];
              if (!Number.isFinite(value)) return null;
              return <div className="metric-bar-row" key={system.id}>
                <div className="bar-track"><div className={`bar series-${index % 5}`} role="img"
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

function AblationTable({ report }) {
  return (
    <section className="report-card">
      <h2>How each retrieval change performed</h2>
      <p>{report.turnCount} identical turns per system. The table uses inherited judgments. Reranking cost is averaged over all turns, including those that scored zero passages.</p>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead><tr><th>Configuration</th><th>nDCG@10</th><th>Δ nDCG and 95% interval</th><th>Known recall@20</th><th>Unjudged@10</th><th>Passages reranked</th><th>Reranking ms</th></tr></thead>
          <tbody>{report.systems.map(system => {
            const cost = report.costs?.[system.id];
            const interval = report.ndcg10Intervals?.[system.id];
            const reference = report.systems.find(entry => entry.id === interval?.reference)?.label;
            return <tr key={system.id}>
              <th scope="row">{system.label}</th><td>{numeric(system.metrics.ndcg10, 4)}</td>
              <td>{interval?.conversations ? <>
                {numeric(interval.delta, 4)} [{numeric(interval.ciLower, 4)}, {numeric(interval.ciUpper, 4)}]
                <br /><small>vs. {reference}</small>
              </> : '—'}</td>
              <td>{numeric(system.metrics.knownRecall20, 4)}</td><td>{numeric(system.metrics.unjudged10, 4)}</td>
              <td>{cost ? numeric(cost.meanCandidates, 1) : '—'}</td><td>{cost ? numeric(cost.meanRerankingMs, 0) : '—'}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <a className="button compact" href="/api/v3/evaluation/ablation/per_turn.csv" download><Icon name="download" size={15} /> Download per-turn ablation results</a>
    </section>
  );
}

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
          {report.ablation?.systems?.length > 0 && <AblationTable report={report.ablation} />}
          {report.review && <section className="report-card">
            <h2>Independent relevance review</h2>
            <p>{report.review.turnCount} new questions across {report.review.conversationCount} conversations. {report.review.judgedPairs} of {report.review.pooledPairs} pooled passages have adjudicated grades.</p>
            {report.review.systems?.length > 0 && <EvaluationChart systems={report.review.systems} />}
            <a className="button compact" href="/api/v3/evaluation/review/pool.csv" download><Icon name="download" size={15} /> Download blind review pool</a>
          </section>}
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
