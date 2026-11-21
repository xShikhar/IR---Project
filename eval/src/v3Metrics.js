import {
  computeNdcgAtK,
  computePrecisionAtK,
  computeRecallAtK,
  computeReciprocalRank
} from './metrics.js';

const metricNames = ['p5', 'p10', 'ndcg10', 'mrr20', 'knownRecall20', 'unjudged10'];

export function scoreRanking(ranked, qrels) {
  const top10 = ranked.slice(0, 10);
  const grades = Object.values(qrels);
  const hasJudgments = grades.length > 0;
  const hasPositive = grades.some(grade => grade >= 1);
  const unjudgedAt10 = top10.filter(result => !Object.hasOwn(qrels, result.docId)).length;

  return {
    p5: hasJudgments ? computePrecisionAtK(ranked, qrels, 5) : null,
    p10: hasJudgments ? computePrecisionAtK(ranked, qrels, 10) : null,
    ndcg10: hasJudgments ? computeNdcgAtK(ranked, qrels, 10) : null,
    mrr20: hasJudgments ? computeReciprocalRank(ranked.slice(0, 20), qrels) : null,
    knownRecall20: hasPositive ? computeRecallAtK(ranked, qrels, 20) : null,
    unjudged10: top10.length ? unjudgedAt10 / top10.length : null,
    retrievedAt10: top10.length,
    judgedAt10: top10.length - unjudgedAt10,
    unjudgedAt10
  };
}

export function summarizeRankings(records) {
  const metrics = {};
  for (const name of metricNames) {
    const values = records.map(record => record[name]).filter(value => value !== null);
    metrics[name] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  const total = name => records.reduce((sum, record) => sum + record[name], 0);
  return {
    metrics,
    coverage: {
      retrievedAt10: total('retrievedAt10'),
      judgedAt10: total('judgedAt10'),
      unjudgedAt10: total('unjudgedAt10'),
      turnsEvaluated: records.filter(record => record.p10 !== null).length,
      turnsWithResults: records.filter(record => record.retrievedAt10 > 0).length
    }
  };
}

export function collectUnjudgedPool({ queryId, topic, query, history }, rankings, qrels) {
  const unjudged = new Map();
  for (const ranking of rankings) {
    for (const result of ranking.slice(0, 10)) {
      if (!Object.hasOwn(qrels, result.docId)) unjudged.set(result.docId, result);
    }
  }

  return [...unjudged.values()].sort((left, right) => left.docId.localeCompare(right.docId)).map(result => ({
    queryId,
    topic,
    query,
    history: history.map((turn, index) => `${index + 1}. ${turn}`).join('\n'),
    docId: result.docId,
    title: result.title,
    passage: result.body,
    relevanceGrade: '',
    notes: ''
  }));
}
