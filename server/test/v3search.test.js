import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { buildIndex } from '../src/index/builder.js';
import { createSearchService } from '../src/v3/search.js';

const passages = [
  { docId: 'p1', title: 'Mercury (planet) - Section 1', domain: 'space', body: 'Mercury is the smallest planet. Its temperature changes substantially during its orbit.' },
  { docId: 'p2', title: 'Mercury (planet) - Section 2', domain: 'space', body: 'Mercury is the smallest planet. Its temperature changes substantially across its orbit.' },
  { docId: 'e1', title: 'Mercury (element) - Section 1', domain: 'chemistry', body: 'Mercury is a liquid metal. Its temperature of freezing is below zero.' },
  { docId: 'e2', title: 'Mercury (element) - Section 2', domain: 'chemistry', body: 'Mercury instruments measure temperature. Liquid metal expands as it warms.' },
  { docId: 't1', title: 'Transformer (deep learning architecture) - Section 1', domain: 'computing', body: 'A learning architecture uses self-attention to process sequences in parallel.' },
  { docId: 't2', title: 'Transformer - Section 1', domain: 'electronics', body: 'An electrical transformer changes voltage through electromagnetic induction.' },
  { docId: 'a1', title: 'Attention (machine learning) - Section 1', domain: 'computing', body: 'Attention assigns weights to parts of an input sequence.' },
  { docId: 'a2', title: 'Representation learning - Section 1', domain: 'computing', body: 'Hidden layers produce meaningful representation vectors.' },
  { docId: 'f1', title: 'Temperature measurement - Section 1', domain: 'chemistry', body: 'Temperature calibration corrects thermocouple uncertainty. Instruments need stable references.' },
  { docId: 'f2', title: 'Thermocouples - Section 1', domain: 'chemistry', body: 'Thermocouple calibration reduces uncertainty across instruments and sensors.' },
];

const service = createSearchService(buildIndex(passages), {
  semanticCacheDir: path.join(import.meta.dirname, 'absent-semantic-cache'),
});
const planetaryTopic = { id: 'planet', title: 'Mercury (planet)', entityTerms: ['Mercury', 'planet'] };

test('article interpretations group multiple sections and distinguish shared names', () => {
  const mercury = service.interpretations('What is Mercury?');
  assert.deepEqual(new Set(mercury.map(item => item.title)), new Set(['Mercury (planet)', 'Mercury (element)']));
  assert.equal(mercury.find(item => item.title === 'Mercury (element)').docCount, 2);
  assert.equal(mercury.find(item => item.title === 'Mercury (element)').id, 'article:chemistry:mercury-element');
  assert.ok(mercury.find(item => item.title === 'Mercury (planet)').terms.includes('planet'));
  assert.match(mercury.find(item => item.title === 'Mercury (planet)').example, /smallest planet/);
  assert.deepEqual(service.interpretations('Mercury planet').map(item => item.title), ['Mercury (planet)']);
  assert.equal(service.interpretations('What is a transformer?').length, 2);
  assert.ok(service.interpretations('temperature changes in liquid metal').length < 2);
});

test('topic terms affect ranking for BM25, cosine, and hybrid while raw retrieval remains present', async () => {
  for (const model of ['bm25', 'cosine', 'hybrid']) {
    const { results, trace } = await service.search('temperature', {
      model, topK: 6, topic: planetaryTopic, diversity: false,
    });
    assert.equal(results[0].domain, 'space', model);
    assert.ok(results.some(item => item.docId === 'f1' && item.origins.includes('raw')), model);
    assert.ok(trace.termWeights.find(item => item.term === 'planet').sources.entity > 0, model);
    assert.ok(results[0].breakdown.termContributions.find(item => item.term === 'planet').contribution > 0, model);
    assert.ok(results[0].breakdown.paths.some(path => path.origin === 'context' && path.contribution > 0), model);
  }
});

test('positive feedback retrieves passages sharing exemplar language with no raw-query overlap', async () => {
  const base = await service.search('temperature', { model: 'bm25', topK: 10, diversity: false });
  assert.ok(!base.results.some(item => item.docId === 'f2'));
  const adapted = await service.search('temperature', {
    model: 'bm25', topK: 10, diversity: false, feedback: { relevant: ['f1'] },
  });
  const match = adapted.results.find(item => item.docId === 'f2');
  assert.ok(match?.origins.includes('feedback'));
  assert.ok(match.breakdown.termContributions.some(item => item.term === 'thermocoupl' && item.sources.feedback > 0));
});

test('domain, excluded phrases and irrelevant judgments apply to retrieval and pinned passages', async () => {
  const { results, trace } = await service.search('temperature', {
    model: 'hybrid', topK: 10, topic: planetaryTopic, domain: 'chemistry', excludedPhrases: ['LIQUID METAL'],
    feedback: { irrelevant: ['f1'], pinned: ['p1', 'e1', 'f1', 'f2'] },
  });
  assert.deepEqual(results.map(item => item.docId), ['f2']);
  assert.ok(results[0].origins.includes('pinned'));
  assert.equal(results[0].breakdown.pinned, true);
  assert.equal(trace.filters.domain, 'chemistry');
});

test('removing an inherited term lets its passages and explicit query occurrences remain', async () => {
  const options = { model: 'bm25', topic: planetaryTopic, excludedTerms: ['planet'], domain: 'space' };
  const inherited = await service.search('temperature', options);
  assert.deepEqual(new Set(inherited.results.map(result => result.docId)), new Set(['p1', 'p2']));
  assert.ok(!inherited.trace.effectiveTerms.includes('planet'));
  const explicit = await service.search('planet temperature', options);
  assert.deepEqual(explicit.trace.termWeights.find(item => item.term === 'planet').sources, {
    current: 1, entity: 0, feedback: 0,
  });
});

test('snippets quote matching source text and record its original word forms', async () => {
  const { results } = await service.search('instruments', { topK: 10, model: 'bm25' });
  const result = results.find(item => item.docId === 'e2');
  assert.ok(result);
  assert.ok(result.body.includes(result.snippet.replace(/^…|…$/g, '').trim()));
  assert.ok(result.highlights.includes('instruments'));
  assert.ok(result.snippet.length <= 280);
});

test('snippets retain matching text deep inside a long sentence', async () => {
  const body = `${'Background applies to this document '.repeat(32)}until the spectrometer detected a signal.`;
  const longPassage = createSearchService(buildIndex([{ docId: 'long', title: 'Optics', domain: 'science', body }]), { semantic: false });
  const { results: [result] } = await longPassage.search('spectrometer', { model: 'bm25' });
  assert.ok(result.highlights.includes('spectrometer'));
  assert.match(result.snippet, /spectrometer detected/);
  assert.ok(body.includes(result.snippet.replace(/^…|…$/g, '').trim()));
  assert.ok(result.snippet.length <= 280);
});

test('MMR prioritizes a different article before a near-duplicate passage', async () => {
  const options = { topK: 3, model: 'bm25', topic: planetaryTopic };
  const base = await service.search('temperature', { ...options, diversity: false });
  const defaultResults = await service.search('temperature', options);
  assert.deepEqual(defaultResults.results.map(item => item.docId), base.results.map(item => item.docId));
  assert.deepEqual(new Set(base.results.slice(0, 2).map(item => item.docId)), new Set(['p1', 'p2']));
  const diverse = await service.search('temperature', { ...options, diversity: true });
  assert.equal(diverse.results[0].docId, base.results[0].docId);
  assert.notEqual(diverse.results[1].domain, 'space');
});

test('semantic mode reports its unavailable cache and falls back to BM25', async () => {
  assert.equal(service.status().semantic.available, false);
  const { results, trace } = await service.search('temperature', { model: 'semantic' });
  assert.ok(results.length > 0);
  assert.equal(trace.requestedModel, 'semantic');
  assert.equal(trace.effectiveModel, 'bm25');
  assert.equal(trace.semantic.available, false);
  assert.ok(trace.semantic.reason);
  assert.ok(results.every(item => !item.origins.includes('semantic')));
});

test('unknown model and invalid depth are rejected', async () => {
  await assert.rejects(service.search('temperature', { model: 'unknown' }), /model/i);
  await assert.rejects(service.search('temperature', { topK: 0 }), /topK/i);
});

test('hard topic lock scopes retrieval and pins, and falls back after other filters', async () => {
  const repeatedSections = Array.from({ length: 12 }, (_, i) => ({
    docId: `telescope-${i}`, title: `Space telescope - Section ${i + 1}`, domain: 'space',
    body: 'The infrared mirror detects faint background light and dust.',
  }));
  const corpus = [...repeatedSections, { docId: 'mirror', title: 'Optical mirrors', domain: 'optics', body: 'Infrared mirror coatings reflect light.' }];
  const search = createSearchService(buildIndex(corpus), { semantic: false });
  const settings = {
    topic: { title: 'Space telescope', entityTerms: ['space', 'telescope'] },
    feedback: { pinned: ['mirror'] },
  };
  const soft = await search.search('infrared mirror', { ...settings, topicLock: 'soft' });
  assert.equal(soft.results[0].docId, 'mirror');
  const locked = await search.search('infrared mirror', { ...settings, topicLock: 'hard' });
  assert.equal(locked.trace.subjectLock.effective, 'hard');
  assert.equal(locked.trace.subjectLock.candidates, 12);
  assert.ok(locked.results.length && locked.results.every(doc => doc.docId.startsWith('telescope-')));
  const fallback = await search.search('infrared mirror', { ...settings, topicLock: 'hard', domain: 'optics' });
  assert.equal(fallback.trace.subjectLock.fallback, true);
  assert.deepEqual(fallback.results.map(doc => doc.docId), ['mirror']);
});
