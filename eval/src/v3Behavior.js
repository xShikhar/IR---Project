import assert from 'node:assert/strict';
import { createWorkspace } from '../../server/src/v3/workspace.js';

function activeTopic(session, expectedTitle) {
  const topic = session.topics.find(entry => entry.id === session.activeTopicId);
  assert.ok(topic?.title.toLowerCase().includes(expectedTitle.toLowerCase()), `Expected an active topic about ${expectedTitle}; got ${topic?.title || 'none'}`);
  return topic;
}

const checks = {
  async 'topic-return'(workspace, { turns, expectedTopics }) {
    const topicIds = [];
    for (const [index, query] of turns.entries()) {
      const response = await workspace.turn(query);
      topicIds.push(activeTopic(response.session, expectedTopics[index]).id);
    }
    const [first, followUp, switched, returned] = topicIds;
    assert.equal(followUp, first, 'The mirror question should stay on the telescope topic');
    assert.notEqual(switched, first, 'CRISPR should have a separate topic');
    assert.equal(returned, first, 'The telescope follow-up should use the original topic ID');
    assert.equal(workspace.snapshot().topics.length, 2, 'A topic return should reuse the existing topic');
  },

  async 'mercury-choice'(workspace, { turns, expectedTopics }) {
    const before = workspace.snapshot();
    const ambiguous = await workspace.turn(turns[0]);
    const options = ambiguous.clarification?.options ?? [];
    const element = options.find(option => option.title.toLowerCase().includes(expectedTopics[0].toLowerCase()));
    assert.ok(element, 'Clarification should offer the corpus-backed Mercury element');
    assert.ok(options.some(option => option.title.toLowerCase().includes('mercury (planet)')), 'Clarification should also offer the planet');
    assert.deepEqual(workspace.snapshot(), before, 'An unresolved query should leave the session intact');

    const chosen = await workspace.turn(turns[0], { interpretationId: element.id });
    activeTopic(chosen.session, expectedTopics[0]);
    assert.equal(chosen.clarification, null, 'Selecting an interpretation should resolve the prompt');
    assert.ok(chosen.results[0]?.title.toLowerCase().includes(expectedTopics[0].toLowerCase()), 'The selected interpretation should lead the ranking');
  },

  async 'feedback-undo'(workspace, { turns, expectedTopics }) {
    const starting = await workspace.turn(turns[0]);
    const topicBefore = activeTopic(starting.session, expectedTopics[0]);
    const pin = starting.results.at(-1);
    assert.ok(pin, 'The initial search should provide a passage to pin');
    await workspace.feedback(pin.docId, 'pin');
    const pinnedSnapshot = workspace.snapshot();
    assert.ok(activeTopic(pinnedSnapshot, expectedTopics[0]).feedback.pinned.includes(pin.docId), 'The passage should be pinned in the active topic');

    const preview = await workspace.turn(turns[1], { preview: true });
    assert.equal(preview.results[0]?.docId, pin.docId, 'A pinned passage should lead the follow-up ranking');
    assert.deepEqual(workspace.snapshot(), pinnedSnapshot, 'Preview should leave session state intact');
    await workspace.undo();
    assert.deepEqual(activeTopic(workspace.snapshot(), expectedTopics[0]).feedback, topicBefore.feedback, 'Undo should restore the previous topic feedback');
  },

  async 'aspect-elaboration'(workspace, { turns }) {
    await workspace.turn(turns[0]);
    await workspace.turn(turns[1]);
    const before = workspace.snapshot();
    const model = 'bm25';
    const inherited = await workspace.turn(turns[2], { model, preview: true });
    const noHistory = await workspace.turn(turns[2], { model, preview: true, useAspectHistory: false });
    const weight = inherited.trace.termWeights.find(entry => entry.term === 'mirror');
    assert.equal(weight?.historyTurn, before.turns.at(-1).id, 'The mirror term should cite its original turn');
    assert.ok(weight.sources.history > 0, 'The carried aspect should receive a ranking weight');
    assert.notDeepEqual(inherited.results.map(entry => entry.docId), noHistory.results.map(entry => entry.docId), 'The weighted aspect should change the ranking');
    const excluded = await workspace.turn(turns[2], { model, preview: true, excludedTerms: ['mirror'] });
    assert.deepEqual(excluded.results.map(entry => entry.docId), noHistory.results.map(entry => entry.docId), 'Removing the inherited aspect should restore the comparison ranking');
    assert.deepEqual(workspace.snapshot(), before, 'Neither preview nor correction should add a conversation turn');
  }
};

export async function evaluateBehavior(index, searchService, scenarios) {
  const cases = [];
  for (const scenario of scenarios) {
    const { id, title } = scenario;
    const check = checks[id];
    if (!Object.hasOwn(checks, id)) throw new Error(`Unknown behavior case: ${id}`);
    try {
      await check(createWorkspace(index, searchService), scenario);
      cases.push({ id, title, passed: true });
    } catch (error) {
      cases.push({ id, title, passed: false, failure: error.message });
    }
  }

  return {
    provenance: 'Synthetic behavior assertions',
    passed: cases.filter(result => result.passed).length,
    total: cases.length,
    cases
  };
}
