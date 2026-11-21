import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createEncoder,SEMANTIC_CACHE_DIR} from '../src/v3/semantic.js';

test('prepared MiniLM inference is finite and does not attempt a network request',{
  skip:!fs.existsSync(path.join(SEMANTIC_CACHE_DIR,'articles.bin')),
},async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=()=>{throw new Error('Runtime network access is forbidden.');};
  let encoder;
  try {
    encoder=await createEncoder(SEMANTIC_CACHE_DIR,false);
    const vector=await encoder.encode(['A telescope observes distant galaxies.']);
    assert.equal(vector.length,384);assert.ok(vector.every(Number.isFinite));
    const norm=Math.sqrt(vector.reduce((sum,v)=>sum+v*v,0));assert.ok(Math.abs(norm-1)<0.001);
  } finally {globalThis.fetch=original;if(encoder)await encoder.dispose();}
});
