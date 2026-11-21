import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executeDemoStep,makeConversationTour} from '../../client/src/demo/demoRunner.js';

test('a failed search check does not report a canned success',async()=>{
  const result=await executeDemoStep({action:'search',query:'JWST',expect:{results:true}}, {sessionId:'demo'}, {
    post:async()=>({results:[],session:{turns:[],topics:[]},trace:{}}),
  });
  assert.equal(result.check.passed,false);
});
test('a clarification waits for the exact corpus-backed choice',async()=>{
  const context={sessionId:'demo',response:{clarification:{options:[{id:'element',title:'Mercury (element)'}]}},pendingQuery:'Mercury'};
  let sent;
  const result=await executeDemoStep({action:'clarify',choice:'Mercury (element)',expect:{results:true}},context,{
    post:async(_route,_id,body)=>{sent=body;return {results:[{docId:'a'}],session:{turns:[{id:'turn_1',query:'Mercury'}],topics:[]},trace:{}};},
  });
  assert.equal(sent.interpretationId,'element');assert.equal(sent.query,'Mercury');assert.equal(result.check.passed,true);
  await assert.rejects(()=>executeDemoStep({action:'clarify',choice:'Missing'},context,{post:async()=>{throw new Error('should not call');}}),/interpretation/i);
});
test('preview checks compare actual committed turn counts',async()=>{
  const session={turns:[{id:'turn_1',query:'JWST'}],topics:[]};
  const result=await executeDemoStep({action:'preview',expect:{preview:true}}, {sessionId:'demo',session,response:{session,results:[]}}, {
    post:async()=>({session:{turns:[...session.turns,{id:'turn_2'}]},results:[],trace:{}}),
  });
  assert.equal(result.check.passed,false);
});
test('original benchmark conversations become executable tours without revealing reference labels',()=>{
  const result=makeConversationTour({id:'conv_01',topic:'IR',turns:[{query:'What is BM25?',goldRewrite:'SECRET'}]});
  assert.equal(result.steps[0].query,'What is BM25?');assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('comparison verification checks the actual server-returned session',async()=>{
  const session={turns:[{id:'turn_1',query:'JWST'}],topics:[]};
  const result=await executeDemoStep({action:'compare',expect:{preview:true}}, {sessionId:'demo',session,lastTurn:session.turns[0]}, {
    post:async()=>({session:{...session,turns:[...session.turns,{id:'turn_2'}]},baseline:{results:[{}]},final:{results:[{}]}}),
  });
  assert.equal(result.check.passed,false);
});
test('unavailable retrieval methods are not presented as verified semantic retrieval',async()=>{
  const result=await executeDemoStep({action:'methods',expect:{methods:4}}, {sessionId:'demo',lastTurn:{id:'turn_1'}}, {
    post:async()=>({comparisons:['bm25','cosine','semantic','hybrid'].map(model=>({model,available:model!=='semantic'}))}),
  });
  assert.equal(result.check.passed,false);
});
