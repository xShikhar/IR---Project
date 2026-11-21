import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectUnjudgedPool, scoreRanking, summarizeRankings } from '../src/v3Metrics.js';

test('an absent judgment counts as unjudged while grade zero counts as judged', () => {
  const ranked = [
    { docId: 'unjudged' },
    { docId: 'irrelevant' },
    { docId: 'relevant' }
  ];
  const result = scoreRanking(ranked, { irrelevant: 0, relevant: 2, omitted: 1 });

  assert.equal(result.p5, 0.2);
  assert.equal(result.p10, 0.1);
  assert.equal(result.mrr20, 1 / 3);
  assert.equal(result.knownRecall20, 0.5);
  assert.equal(result.retrievedAt10, 3);
  assert.equal(result.judgedAt10, 2);
  assert.equal(result.unjudgedAt10, 1);
  assert.equal(result.unjudged10, 1 / 3);
});

test('ranking aggregates skip absent qrels and omit recall when no positives have been judged', () => {
  const scores = [
    scoreRanking([{ docId: 'd1' }], { d1: 2 }),
    scoreRanking([{ docId: 'd2' }], {}),
    scoreRanking([{ docId: 'd3' }], { d3: 0 })
  ];
  const result = summarizeRankings(scores);

  assert.equal(scores[1].ndcg10, null);
  assert.equal(result.metrics.p10, 0.05);
  assert.equal(result.metrics.knownRecall20, 1);
  assert.equal(result.coverage.turnsEvaluated, 2);
  assert.equal(result.coverage.unjudgedAt10, 1);
});

test('the pool deduplicates unknown top-ten passages across systems for the same turn', () => {
  const shared = { docId: 'a', title: 'Shared', body: 'Passage text' };
  const judged = { docId: 'b', title: 'Known zero', body: 'Passage text' };
  const turn = {
    queryId: 'dialogue_1', topic: 'Mercury (planet)', query: 'And its orbit?',
    history: ['Tell me about Mercury.']
  };
  const pool = collectUnjudgedPool(turn, [[shared, judged], [shared]], { b: 0 });

  assert.deepEqual(pool, [{
    queryId: 'dialogue_1',
    topic: 'Mercury (planet)',
    query: 'And its orbit?',
    history: '1. Tell me about Mercury.',
    docId: 'a',
    title: 'Shared',
    passage: 'Passage text',
    relevanceGrade: '',
    notes: ''
  }]);
});
