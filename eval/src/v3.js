import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { executeConversationalTurn } from '../../server/src/api/traceAssembly.js';
import { CONFIG } from '../../server/src/config/index.js';
import { ContextState } from '../../server/src/conversation/contextState.js';
import { loadIndex } from '../../server/src/index/serializer.js';
import { executeRetrieval } from '../../server/src/retrieval/engine.js';
import { createSearchService } from '../../server/src/v3/search.js';
import { createWorkspace } from '../../server/src/v3/workspace.js';
import { validateCompleteness } from './qrelsLoader.js';
import { evaluateBehavior } from './v3Behavior.js';
import { collectUnjudgedPool, scoreRanking, summarizeRankings } from './v3Metrics.js';

const perTurnColumns = [
  'system', 'conversationId', 'turnId', 'queryId', 'query', 'p5', 'p10', 'ndcg10', 'mrr20',
  'knownRecall20', 'unjudged10', 'retrievedAt10', 'judgedAt10', 'unjudgedAt10',
  'clarificationOffered', 'activeTopic', 'rankedDocIds'
];
const poolColumns = [
  'queryId', 'topic', 'query', 'history', 'docId', 'title', 'passage', 'relevanceGrade', 'notes'
];
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function writeCsv(file, columns, records) {
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = records.map(record => columns.map(column => quote(record[column])).join(','));
  fs.writeFileSync(file, [columns.join(','), ...rows, ''].join('\r\n'), 'utf8');
}

export async function runV3Evaluation({ split = 'test', semantic = false } = {}) {
  if (!['test', 'dev', 'all'].includes(split)) throw new Error('Choose --split=test, --split=dev, or --split=all.');
  const splits = readJson(CONFIG.paths.splitsFile);
  const targetIds = new Set(splits[split]?.conversationIds);
  const conversations = readJson(CONFIG.paths.conversationsFile)
    .filter(conversation => split === 'all' || targetIds.has(conversation.id));
  if (conversations.length === 0 || (split !== 'all' && conversations.length !== targetIds.size)) {
    throw new Error(`The ${split} split does not match the inherited conversations.`);
  }
  const qrels = readJson(CONFIG.paths.qrelsFile);
  const index = loadIndex();
  const lexicalSearch = createSearchService(index, { semantic: false });
  const workspaceSystems = [{
    id: 'turntrace2',
    label: 'TurnTrace 2 lexical hybrid',
    searchService: lexicalSearch
  }];
  if (semantic) {
    const searchService = createSearchService(index);
    verifySemantic(searchService);
    workspaceSystems.push({ id: 'turntrace2_full', label: 'TurnTrace 2 full hybrid', searchService });
  }
  const systems = [
    { id: 'raw_bm25', label: 'Raw BM25' },
    { id: 'midterm', label: 'Midterm TurnTrace' },
    ...workspaceSystems.map(({ id, label }) => ({ id, label }))
  ];
  const scenarios = readJson(path.join(CONFIG.paths.dataDir, 'v3_scenarios.json'));
  const completeness = validateCompleteness(conversations, qrels);
  const missingTurnIds = new Set(completeness.missingTurns);
  const records = [];
  const pool = [];
  let turnsWithoutPositiveJudgment = 0;
  const topK = 20;

  for (const conversation of conversations) {
    const history = [];
    const midtermState = new ContextState({ mode: 'v2' });
    const workspaces = workspaceSystems.map(({ searchService }) => createWorkspace(index, searchService));
    for (const { turnId, query } of conversation.turns) {
      const queryId = `${conversation.id}_${turnId}`;
      const turnQrels = qrels[queryId] ?? {};
      if (!missingTurnIds.has(queryId) && !Object.values(turnQrels).some(grade => grade >= 1)) {
        turnsWithoutPositiveJudgment++;
      }

      const raw = executeRetrieval(query, index, { model: 'bm25', topK });
      const midterm = await executeConversationalTurn(query, midtermState, index, { topK });
      const runs = [
        { results: raw.results },
        { results: midterm.results, clarification: midterm.trace.clarification?.fired }
      ];
      for (const workspace of workspaces) {
        const v3 = await workspace.turn(query, { model: 'hybrid', topK, diversity: false });
        runs.push({
          results: v3.results,
          clarification: Boolean(v3.clarification),
          activeTopic: v3.session.topics.find(topic => topic.id === v3.session.activeTopicId)?.title
        });
      }

      for (const [index, run] of runs.entries()) {
        records.push({
          system: systems[index].id,
          conversationId: conversation.id,
          turnId,
          queryId,
          query,
          ...scoreRanking(run.results, turnQrels),
          clarificationOffered: run.clarification ?? false,
          activeTopic: run.activeTopic ?? '',
          rankedDocIds: run.results.map(result => result.docId).join(' ')
        });
      }
      pool.push(...collectUnjudgedPool({
        queryId,
        topic: conversation.topic,
        query,
        history
      }, runs.map(run => run.results), turnQrels));
      history.push(query);
    }
  }

  const semanticStatus = semantic ? verifySemantic(workspaceSystems.at(-1).searchService) : null;
  const summary = {
    schemaVersion: 1,
    split,
    semantic: semanticStatus,
    conversationCount: conversations.length,
    turnCount: completeness.totalTurns,
    corpusDocumentCount: Object.keys(index.docs).length,
    judgments: {
      source: 'data/qrels.json',
      provenance: 'Inherited LLM judgments',
      humanValidated: false,
      judgedTurns: completeness.judgedTurnsCount,
      missingTurnIds: completeness.missingTurns,
      judgedPairs: completeness.totalJudgedPairs,
      turnsWithoutPositiveJudgment
    },
    systems: systems.map(system => ({
      ...system,
      ...summarizeRankings(records.filter(record => record.system === system.id))
    })),
    behavior: await evaluateBehavior(index, lexicalSearch, scenarios),
    pooling: { pairs: pool.length },
    artifacts: { perTurn: 'per_turn.csv', unjudgedPool: 'unjudged_pool.csv' }
  };

  const v3OutputDir = semantic
    ? path.join(CONFIG.paths.evalOutputDir, 'v3', 'semantic')
    : path.join(CONFIG.paths.evalOutputDir, 'v3');
  const outputDir = split === 'test' ? v3OutputDir : path.join(v3OutputDir, split);
  fs.mkdirSync(outputDir, { recursive: true });
  writeCsv(path.join(outputDir, summary.artifacts.perTurn), perTurnColumns, records);
  writeCsv(path.join(outputDir, summary.artifacts.unjudgedPool), poolColumns, pool);
  fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summary;
}

function verifySemantic(searchService) {
  const status = searchService.status().semantic;
  if (!status?.available) {
    throw new Error(`Full hybrid evaluation requires a working local semantic cache. Run npm run prepare:semantic.${status?.reason ? ` ${status.reason}` : ''}`);
  }
  return status;
}

function parseOptions(args) {
  const options = {};
  for (const arg of args) {
    if (arg === '--semantic' && options.semantic === undefined) {
      options.semantic = true;
    } else if (arg.startsWith('--split=') && options.split === undefined) {
      options.split = arg.slice('--split='.length);
    } else {
      throw new Error('Usage: node eval/src/v3.js [--split=test|dev|all] [--semantic]');
    }
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const summary = await runV3Evaluation(parseOptions(process.argv.slice(2)));
  console.log(`TurnTrace 2 • ${summary.split.toUpperCase()} • ${summary.turnCount} turns • ${summary.judgments.judgedPairs} inherited judgments`);
  console.table(summary.systems.map(({ label, metrics }) => ({
    system: label,
    ...Object.fromEntries(Object.entries(metrics).map(([metric, value]) => [metric, value?.toFixed(4) ?? '—']))
  })));
  console.log(`${summary.behavior.passed}/${summary.behavior.total} synthetic behavior cases passed. ${summary.pooling.pairs} unjudged turn–passage pairs exported.`);
  for (const result of summary.behavior.cases.filter(result => !result.passed)) console.error(`${result.title}: ${result.failure}`);
  if (summary.behavior.passed < summary.behavior.total) process.exitCode = 1;
}
