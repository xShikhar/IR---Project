import { before,after,describe,it } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/api/server.js';

describe('v3 API integration',()=>{
  let server,url;
  before(async()=>{server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});url=`http://127.0.0.1:${server.address().port}`;});
  after(async()=>{await new Promise(resolve=>server.close(resolve));});
  const post=async(path,body)=>{const r=await fetch(`${url}/api/v3/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  it('validates model and session identifiers',async()=>{
    assert.equal((await post('search',{query:'JWST',model:'invalid'})).status,400);
    assert.equal((await post('search',{query:'JWST',sessionId:'../../escape'})).status,400);
    assert.equal((await post('search',{query:'  '})).status,400);
    for(const sessionId of [false,0,'',null])assert.equal((await post('search',{query:'JWST',sessionId})).status,400);
  });
  it('commits one turn, previews without mutation, exports and isolates sessions',async()=>{
    const result=await post('search',{query:'What is the James Webb Space Telescope?',sessionId:'api_v3_a',model:'bm25'});
    assert.equal(result.status,200);assert.ok(result.body.results.length);assert.equal(result.body.session.turns.length,1);
    assert.equal((await post('preview',{sessionId:'api_v3_a',model:'cosine'})).status,200);
    const a=await (await fetch(`${url}/api/v3/session?sessionId=api_v3_a`)).json();
    assert.equal(a.turns.length,1);
    const b=await (await fetch(`${url}/api/v3/session?sessionId=api_v3_b`)).json();assert.equal(b.turns.length,0);
    const exported=await fetch(`${url}/api/v3/export?sessionId=api_v3_a`);assert.match(exported.headers.get('content-disposition'),/attachment/);
  });
  it('clarifies a bare ambiguous entity and persists selected interpretation',async()=>{
    const r=await post('search',{query:'Mercury',sessionId:'api_v3_mercury',model:'bm25'});
    assert.equal(r.status,200);assert.ok(r.body.clarification?.options.length>=2);
    const element=r.body.clarification.options.find(x=>/\(element\)/i.test(x.title));assert.ok(element);
    const chosen=await post('search',{query:'Mercury',sessionId:'api_v3_mercury',model:'bm25',interpretationId:element.id});
    assert.equal(chosen.body.session.topics[0].title,'Mercury (element)');
    const broad = await post('search', { query: 'Mercury', sessionId: 'api_v3_mercury_all', interpretationId: 'all-interpretations' });
    assert.equal(broad.status, 200);
    assert.equal(broad.body.clarification, null);
    assert.equal(broad.body.session.topics[0].interpretationId, null);
    assert.ok(broad.body.results.length);
  });
  it('comparison does not add conversational turns',async()=>{
    const r=await post('compare',{query:'What is the James Webb Space Telescope?',sessionId:'api_v3_a',model:'bm25'});
    assert.equal(r.status,200);assert.ok(r.body.baseline.results.length);assert.ok(r.body.final.results.length);
    assert.equal(r.body.session.turns.length,1);
  });
  it('historical comparisons use the selected question and preserve its model',async()=>{
    await post('search',{query:'Explain CRISPR gene editing.',sessionId:'api_v3_a',model:'cosine'});
    const r=await post('compare',{sessionId:'api_v3_a',turnId:'turn_1'});
    assert.equal(r.status,200);
    assert.equal(r.body.query,'What is the James Webb Space Telescope?');
    assert.equal(r.body.final.trace.requestedModel,'bm25');
    assert.equal(r.body.session.turns.length,2);
    assert.equal((await post('search',{sessionId:'api_v3_a',query:'JWST',turnId:'turn_1'})).status,400);
  });
  it('clears a previous domain filter with an explicit null preview override',async()=>{
    await post('search',{sessionId:'api_v3_filter',query:'James Webb Space Telescope',model:'bm25',domain:'space_physics'});
    const r=await post('preview',{sessionId:'api_v3_filter',domain:null});
    assert.equal(r.status,200);assert.equal(r.body.trace.filters.domain,null);
  });
  it('replays an earlier matching question without including later turns or changing the session', async () => {
    const sessionId = 'api_v3_replay';
    const query = 'What about its mirror?';
    await post('search', { sessionId, query: 'James Webb Space Telescope', model: 'bm25' });
    await post('search', { sessionId, query, model: 'bm25' });
    const before = await post('compare', { sessionId, query });
    assert.equal(before.status, 200);
    const later = await post('search', { sessionId, query: 'Explain CRISPR gene editing.', model: 'cosine' });
    const after = await post('compare', { sessionId, query });
    assert.equal(after.status, 200);
    assert.deepEqual(after.body.replay, { turnId: 'turn_2', priorTurnCount: 1 });
    assert.deepEqual(after.body.baseline.results, before.body.baseline.results);
    assert.deepEqual(after.body.final.results, before.body.final.results);
    assert.deepEqual(after.body.session, later.body.session);
  });
});
