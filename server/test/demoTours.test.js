import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/api/server.js';
import {executeDemoStep} from '../../client/src/demo/demoRunner.js';
let server,base;
before(async()=>{server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base=`http://127.0.0.1:${server.address().port}/api/v3`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));});
const api={
  async get(route){const r=await fetch(`${base}/${route}`);assert.ok(r.ok,`${route}: ${r.status}`);return r.json();},
  async post(route,sessionId,body){const r=await fetch(`${base}/${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,...body})});const result=await r.json();assert.ok(r.ok,`${route}: ${JSON.stringify(result)}`);return result;}
};
test('the demonstration catalog preserves original conversations without reference answers',async()=>{
  const catalog=await api.get('demos');
  assert.equal(catalog.tours.length,11);assert.equal(catalog.conversations.length,14);
  assert.equal(new Set(catalog.tours.map(t=>t.id)).size,catalog.tours.length);
  assert.ok(!JSON.stringify(catalog.conversations).includes('goldRewrite'));
  for(const tour of catalog.tours){assert.ok(tour.steps.length);assert.ok(tour.presenterNote);}
});
test('every guided demonstration executes and verifies its real API behavior',{timeout:240_000},async t=>{
  const {tours}=await api.get('demos');
  const health=await (await fetch(`${base.replace('/api/v3','')}/api/health`)).json();
  for(const tour of tours){
    const unavailable=(tour.requires||[]).some(required=>required==='semantic'?!health.semantic?.semantic?.available:!health.semantic?.reranker?.available);
    await t.test(tour.id,{skip:unavailable},async()=>{
      const sessionId=`tour_test_${tour.id.replaceAll('-','_')}`;
      let context={sessionId,session:await api.get(`session?sessionId=${sessionId}`)};
      for(const step of tour.steps){
        const result=await executeDemoStep(step,context,api);
        assert.equal(result.awaitingChoice,false,`${tour.id}: unexpected clarification at ${step.title}`);
        assert.equal(result.check.passed,true,`${tour.id} / ${step.title}: ${JSON.stringify(result.check.details)}`);
        context=result.context;
      }
    });
  }
});
