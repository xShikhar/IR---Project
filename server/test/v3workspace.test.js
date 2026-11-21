import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace } from '../src/v3/workspace.js';

const index = { docs: {
  a: { title: 'James Webb Space Telescope - Section 1', body:'An infrared telescope.',domain:'space_physics' },
  b: { title: 'CRISPR gene editing - Section 1', body:'Editing DNA.',domain:'biology_medicine' },
  c: { title: 'Mercury (planet) - Section 1', body:'A planet.',domain:'space_physics' },
  d: { title: 'Mercury (element) - Section 1', body:'A toxic metal.',domain:'biology_medicine' }
  ,e: { title: 'Rocket - Section 1', body:'A launch vehicle.',domain:'space_physics' }
  ,f: { title: 'Nervous system - Section 1', body:'A network of neurons.',domain:'biology_medicine' }
  ,g: { title: 'Museum of Work - Section 1', body:'An industrial museum.',domain:'history_civilization' }
  ,h: { title: 'Amplitude modulation - Section 1', body:'A radio technique.',domain:'cs_ai' }
}};
const service = {
  async search(query,options) { return {results:[{docId:'a',title:options.topic?.title || query,score:1}],trace:{model:options.model}}; },
  interpretations(query) { return /mercury/i.test(query) ? [
    {id:'planet',title:'Mercury (planet)',terms:['mercuri','planet'],docCount:1,example:'A planet'},
    {id:'element',title:'Mercury (element)',terms:['mercuri','element'],docCount:1,example:'A toxic metal'}
  ] : []; }
};

describe('v3 topic workspace',()=>{
  it('preserves separate branches and resumes an earlier explicitly referenced topic',async()=>{
    const w=createWorkspace(index,service);
    await w.turn('What is the James Webb Space Telescope?');
    const first=w.snapshot().activeTopicId;
    await w.turn('Explain CRISPR gene editing.');
    assert.equal(w.snapshot().topics.length,2);
    const result=await w.turn('Back to JWST, what instruments does it carry?');
    assert.equal(result.trace.decision.action,'RESUME');
    assert.equal(w.snapshot().activeTopicId,first);
    assert.equal(w.snapshot().topics[0].turnCount,2);
  });
  it('preview is immutable and committing records a query once',async()=>{
    const w=createWorkspace(index,service);
    await w.turn('Explain CRISPR gene editing.');
    const before=JSON.stringify(w.snapshot());
    await w.turn('What are its limitations?',{preview:true,model:'bm25'});
    assert.equal(JSON.stringify(w.snapshot()),before);
    assert.equal(w.snapshot().turns.length,1);
  });
  it('does not mistake a follow-up aspect for a new subject',async()=>{
    const w=createWorkspace(index,service);
    await w.turn('What is the James Webb Space Telescope?');
    const topic=w.snapshot().activeTopicId;
    await w.turn('What rocket launched it into space?');
    assert.equal(w.snapshot().activeTopicId,topic);
    assert.equal(w.snapshot().topics.length,1);
  });
  it('does not route incidental verbs or word stems into unrelated article topics',async()=>{
    const w=createWorkspace(index,service);
    await w.turn('James Webb Space Telescope');
    await w.turn('Which engineers worked there?');
    await w.turn('Where did the command module splash down?');
    assert.equal(w.snapshot().topics.length,1);
    assert.equal(w.snapshot().topics[0].title,'James Webb Space Telescope');
  });
  it('clarification does not commit until a valid interpretation is chosen',async()=>{
    const w=createWorkspace(index,service);
    const r=await w.turn('Tell me about Mercury');
    assert.equal(r.clarification.options.length,2);
    assert.equal(w.snapshot().turns.length,0);
    await w.turn('Tell me about Mercury',{interpretationId:'element'});
    assert.equal(w.snapshot().topics[0].title,'Mercury (element)');
    await w.turn('How does it affect the nervous system?');
    assert.equal(w.snapshot().topics[0].turnCount,2);
    assert.equal(w.snapshot().topics.length,1);
  });
  it('still clarifies ambiguity when the user requests a new topic',async()=>{
    const w=createWorkspace(index,service);
    const result=await w.turn('Mercury',{newTopic:true});
    assert.equal(result.clarification?.options.length,2);
    assert.equal(w.snapshot().topics.length,0);
  });
  it('recognizes ordinary clarification prompts after stemming question words',async()=>{
    for(const prompt of ['Please explain Mercury','Describe Mercury','Give me an overview of Mercury','What does Mercury mean?']) {
      const w=createWorkspace(index,service);
      assert.equal((await w.turn(prompt)).clarification?.options.length,2,prompt);
    }
  });
  it('retains an explicitly chosen sense when the ambiguous name is repeated',async()=>{
    const w=createWorkspace(index,service);
    await w.turn('Mercury',{interpretationId:'element'});
    const result=await w.turn('Tell me about Mercury');
    assert.equal(result.clarification,null);
    assert.equal(result.session.topics[0].title,'Mercury (element)');
    assert.equal(result.session.topics.length,1);
  });
  it('feedback is topic-scoped, undoable, and snapshots are detached',async()=>{
    const w=createWorkspace(index,service);
    await w.turn('Explain CRISPR gene editing.');
    w.feedback('b','relevant');
    assert.deepEqual(w.snapshot().topics[0].feedback.relevant,['b']);
    w.undo();
    assert.deepEqual(w.snapshot().topics[0].feedback.relevant,[]);
    const external=w.snapshot();external.topics[0].title='corrupt';
    assert.notEqual(w.snapshot().topics[0].title,'corrupt');
  });
  it('replays the first turn from its snapshot even when a topic ID is supplied',async()=>{
    const w=createWorkspace(index,service);
    const first=await w.turn('What is the James Webb Space Telescope?');
    await w.turn('Explain CRISPR gene editing.');
    const before=JSON.stringify(w.snapshot());
    const r=await w.turn(first.session.turns[0].query,{preview:true,turnId:'turn_1',topicId:first.session.activeTopicId});
    assert.equal(r.results[0].title,'James Webb Space Telescope');
    assert.equal(JSON.stringify(w.snapshot()),before);
  });
  it('applies feedback to the displayed historical topic without changing the active topic',async()=>{
    const w=createWorkspace(index,service);
    const first=await w.turn('What is the James Webb Space Telescope?');
    await w.turn('Explain CRISPR gene editing.');
    w.feedback('a','pin',first.session.activeTopicId);
    assert.deepEqual(w.snapshot().topics[0].feedback.pinned,['a']);
    assert.deepEqual(w.snapshot().topics[1].feedback.pinned,[]);
    assert.equal(w.snapshot().activeTopicId,'topic_2');
  });
  it('unpins a passage without discarding its separate relevance annotation',async()=>{
    const w=createWorkspace(index,service);
    await w.turn('James Webb Space Telescope');
    w.feedback('a','relevant');w.feedback('a','pin');w.feedback('a','unpin');
    assert.deepEqual(w.snapshot().topics[0].feedback.relevant,['a']);
    assert.deepEqual(w.snapshot().topics[0].feedback.pinned,[]);
  });
  it('rejects historical turn IDs on commits instead of truncating future turns',async()=>{
    const w=createWorkspace(index,service);
    await w.turn('James Webb Space Telescope');await w.turn('CRISPR gene editing');
    const before=JSON.stringify(w.snapshot());
    await assert.rejects(()=>w.turn('James Webb Space Telescope',{turnId:'turn_1'}),/preview/i);
    assert.equal(JSON.stringify(w.snapshot()),before);
  });
  it('confirms an existing sense and respects forced separate topics for the same interpretation',async()=>{
    const w=createWorkspace(index,service);
    await w.turn('Mercury (element)');
    await w.turn('Mercury',{interpretationId:'element'});
    assert.equal((await w.turn('Mercury')).clarification,null);
    await w.turn('Mercury',{newTopic:true,interpretationId:'element'});
    assert.equal(w.snapshot().topics.length,2);
    const second=w.snapshot().activeTopicId;
    await w.turn('Mercury (element)');
    assert.equal(w.snapshot().activeTopicId,second);
  });
  it('isolates workspaces and rejects invalid selections or feedback',async()=>{
    const a=createWorkspace(index,service),b=createWorkspace(index,service);
    await a.turn('Explain CRISPR gene editing.');
    assert.equal(b.snapshot().topics.length,0);
    assert.throws(()=>a.selectTopic('missing'),/topic/i);
    assert.throws(()=>a.feedback('missing','relevant'),/document/i);
    await assert.rejects(()=>a.turn('Tell me about Mercury',{interpretationId:'invalid'}),/interpretation/i);
  });
});
