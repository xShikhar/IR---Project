import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { executeConversationalTurn } from '../../server/src/api/traceAssembly.js';
import { CONFIG } from '../../server/src/config/index.js';
import { ContextState } from '../../server/src/conversation/contextState.js';
import { loadIndex } from '../../server/src/index/serializer.js';
import { executeRetrieval } from '../../server/src/retrieval/engine.js';
import { createSearchService } from '../../server/src/v3/search.js';
import { createWorkspace } from '../../server/src/v3/workspace.js';
import { collectUnjudgedPool, scoreRanking, summarizeRankings } from './v3Metrics.js';

const { values } = parseArgs({ options: { judgments: { type: 'string' } } });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const dialogues = read(path.join(CONFIG.paths.dataDir, 'review_dialogues.json'));
const index = loadIndex();
const search = createSearchService(index);
if (!search.status().semantic.available || !search.status().reranker.available) {
  throw new Error('Prepare both semantic models before generating the blind review pool.');
}

const systems = [
  { id: 'raw_bm25', label: 'Raw BM25' },
  { id: 'midterm', label: 'Midterm TurnTrace' },
  { id: 'turntrace2_full', label: 'TurnTrace 2 full hybrid' },
  { id: 'rerank_fixed', label: 'Full hybrid with fixed-depth reranking' },
  { id: 'rerank_adaptive', label: 'Full hybrid with adaptive reranking' },
];
const pool = [];
const rankings = [];
const topK = 20;
for (const conversation of dialogues) {
  const midterm = new ContextState({ mode: 'v2' });
  const workspaces = ['off', 'fixed', 'adaptive'].map(rerank => ({ rerank, workspace: createWorkspace(index, search) }));
  const history = [];
  for (const [position, query] of conversation.turns.entries()) {
    const queryId = `${conversation.id}_turn_${position + 1}`;
    const runs = [
      executeRetrieval(query, index, { model: 'bm25', topK }).results,
      (await executeConversationalTurn(query, midterm, index, { topK })).results,
    ];
    for (const { rerank, workspace } of workspaces) {
      const run = await workspace.turn(query, { topK, rerank });
      if (rerank !== 'off' && run.results.length && !run.trace.reranking?.available) {
        throw new Error(run.trace.reranking?.reason);
      }
      runs.push(run.results);
    }
    pool.push(...collectUnjudgedPool({ queryId, topic: conversation.topic, query, history }, runs, {}, topK));
    rankings.push({ queryId, runs });
    history.push(query);
  }
}

const judgments = values.judgments ? read(values.judgments) : {};
const reviewable = new Map(rankings.map(({ queryId }) => [queryId, new Set()]));
for (const row of pool) reviewable.get(row.queryId).add(row.docId);
let judgedPairs = 0;
for (const [queryId, grades] of Object.entries(judgments)) {
  for (const [docId, grade] of Object.entries(grades)) {
    if (!reviewable.get(queryId)?.has(docId) || ![0, 1, 2].includes(grade)) {
      throw new Error(`Invalid review grade for ${queryId} / ${docId}.`);
    }
    judgedPairs++;
  }
}
const summary = {
  conversationCount: dialogues.length, turnCount: rankings.length,
  pooledPairs: pool.length, judgedPairs,
  systems: judgedPairs === pool.length && pool.length > 0 ? systems.map((system, position) => ({
    ...system,
    ...summarizeRankings(rankings.map(({ queryId, runs }) => scoreRanking(runs[position], judgments[queryId] ?? {}))),
  })) : [],
};
const directory = path.join(CONFIG.paths.evalOutputDir, 'v3', 'review');
fs.mkdirSync(directory, { recursive: true });
const columns = ['queryId', 'topic', 'query', 'history', 'docId', 'title', 'passage', 'relevanceGrade', 'notes'];
const quote = value => `"${String(value).replaceAll('"', '""')}"`;
fs.writeFileSync(path.join(directory, 'pool.csv'), [
  columns.join(','),
  ...pool.map(row => columns.map(column => quote(row[column])).join(',')), '',
].join('\r\n'));
fs.writeFileSync(path.join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`${summary.turnCount} review turns, ${summary.pooledPairs} blinded pairs, ${judgedPairs} graded.`);
