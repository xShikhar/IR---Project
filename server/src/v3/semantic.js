import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config/index.js';

export const SEMANTIC_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const SEMANTIC_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';
export const SEMANTIC_CACHE_DIR = path.join(CONFIG.paths.dataDir, 'raw', 'semantic');
const VECTOR_FILE = 'articles.bin';
const DIMENSION = 384;
const FORMAT = 1;
const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];

export function articleInput(article) {
  const lead = article.docs.slice(0, 2).map(doc => doc.body.trim().replace(/\s+/gu, ' ')).join(' ');
  return `${article.title}. ${lead.slice(0, 850)}`;
}

function fingerprint(articles) {
  const hash = createHash('sha256');
  for (const article of articles) {
    hash.update(JSON.stringify([article.id, articleInput(article)]));
  }
  return hash.digest('hex');
}

export async function createEncoder(cacheDir, allowDownload) {
  const { pipeline, env } = await import('@huggingface/transformers');
  // Keep a stable pinned layout across Transformers.js versions. Runtime never
  // contacts the Hub; preparation is the sole explicit download boundary.
  const modelDir=path.join(cacheDir,'models',SEMANTIC_MODEL,SEMANTIC_REVISION);
  for(const file of MODEL_FILES) {
    const target=path.join(modelDir,file);
    if(fs.existsSync(target))continue;
    if(!allowDownload)throw new Error(`Local model file is missing: ${file}. Run npm run prepare:semantic.`);
    const response=await fetch(`https://huggingface.co/${SEMANTIC_MODEL}/resolve/${SEMANTIC_REVISION}/${file}`);
    if(!response.ok)throw new Error(`Could not download pinned model file ${file}: HTTP ${response.status}`);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    const temporary=`${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary,Buffer.from(await response.arrayBuffer()));
    fs.renameSync(temporary,target);
  }
  env.allowRemoteModels=false;
  const encoder = await pipeline('feature-extraction', modelDir.replaceAll('\\','/'), {
    local_files_only: true,
    device: 'cpu',
    dtype: 'q8',
    session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 },
  });

  return {
    async encode(inputs) {
      const tensor = await encoder(inputs, { pooling: 'mean', normalize: true });
      if (tensor.dims[0] !== inputs.length || tensor.dims[1] !== DIMENSION) {
        throw new Error(`Unexpected output shape from ${SEMANTIC_MODEL}`);
      }
      return tensor.data;
    },
    dispose: () => encoder.dispose(),
  };
}

function serializeVectors(articles, vectors) {
  const metadata = Buffer.from(JSON.stringify({
    format: FORMAT,
    model: SEMANTIC_MODEL,
    revision: SEMANTIC_REVISION,
    dimension: DIMENSION,
    fingerprint: fingerprint(articles),
    count: articles.length,
  }));
  const vectorOffset = Math.ceil((4 + metadata.length) / 4) * 4;
  const buffer = Buffer.alloc(vectorOffset + vectors.byteLength);
  buffer.writeUInt32LE(metadata.length);
  metadata.copy(buffer, 4);
  Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength).copy(buffer, vectorOffset);
  return buffer;
}

function loadVectors(articles, cacheDir) {
  const cacheFile = path.join(cacheDir, VECTOR_FILE);
  if (!fs.existsSync(cacheFile)) {
    throw new Error('Article embeddings are missing. Run npm run prepare:semantic.');
  }
  const buffer = fs.readFileSync(cacheFile);
  const metadataLength = buffer.readUInt32LE();
  const metadata = JSON.parse(buffer.toString('utf8', 4, 4 + metadataLength));
  const vectorOffset = Math.ceil((4 + metadataLength) / 4) * 4;
  if (metadata.format !== FORMAT || metadata.model !== SEMANTIC_MODEL || metadata.revision !== SEMANTIC_REVISION
    || metadata.dimension !== DIMENSION || metadata.count !== articles.length
    || buffer.length !== vectorOffset + articles.length * DIMENSION * Float32Array.BYTES_PER_ELEMENT
    || metadata.fingerprint !== fingerprint(articles)) {
    throw new Error('Article embeddings do not match this corpus. Run npm run prepare:semantic.');
  }
  const vectorData = new Float32Array(buffer.buffer, buffer.byteOffset + vectorOffset, articles.length * DIMENSION);
  if (!vectorData.every(Number.isFinite)) throw new Error('Article embeddings contain invalid values.');
  return new Map(articles.map((article, position) => [
    article.id, vectorData.subarray(position * DIMENSION, (position + 1) * DIMENSION),
  ]));
}

export async function prepareArticleEmbeddings(articles, { cacheDir = SEMANTIC_CACHE_DIR, progress = () => {} } = {}) {
  if (!articles.length) throw new Error('The corpus has no articles to encode.');
  fs.mkdirSync(cacheDir, { recursive: true });
  const encoder = await createEncoder(cacheDir, true);
  const vectors = new Float32Array(articles.length * DIMENSION);
  try {
    const batchSize = 16;
    for (let first = 0; first < articles.length; first += batchSize) {
      const batch = articles.slice(first, first + batchSize);
      const embeddings = await encoder.encode(batch.map(articleInput));
      vectors.set(embeddings, first * DIMENSION);
      progress(first + batch.length, articles.length);
    }
  } finally {
    await encoder.dispose();
  }

  const file = path.join(cacheDir, VECTOR_FILE);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, serializeVectors(articles, vectors));
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return file;
}

export function createSemanticRetriever(articles, cacheDir = SEMANTIC_CACHE_DIR) {
  let vectors = null;
  let encoderPromise;
  let reason = null;
  const queryCache = new Map();

  try {
    vectors = loadVectors(articles, cacheDir);
    import.meta.resolve('@huggingface/transformers');
    if (!MODEL_FILES.every(file => fs.existsSync(path.join(cacheDir, 'models', SEMANTIC_MODEL, SEMANTIC_REVISION, file)))) {
      throw new Error('The local semantic model files are missing. Run npm run prepare:semantic.');
    }
  } catch (error) {
    vectors = null;
    reason = error.code === 'ERR_MODULE_NOT_FOUND' ? 'The optional Transformers.js dependency is missing.' : error.message;
  }

  function status() {
    return {
      available: Boolean(vectors),
      model: SEMANTIC_MODEL,
      granularity: 'article',
      articleCount: vectors?.size ?? 0,
      reason,
    };
  }

  function embed(text) {
    if (!queryCache.has(text)) {
      encoderPromise ??= createEncoder(cacheDir, false);
      queryCache.set(text, encoderPromise.then(encoder => encoder.encode([text])));
      if (queryCache.size > 128) queryCache.delete(queryCache.keys().next().value);
    }
    return queryCache.get(text);
  }

  return {
    status,
    async rank(query, entityText, positiveArticles, negativeArticles) {
      if (!vectors) return null;
      try {
        const [current, entity] = await Promise.all([embed(query), entityText ? embed(entityText) : null]);
        const combined = new Float32Array(current);
        if (entity) addVector(combined, entity, 0.45);
        for (const id of positiveArticles) addVector(combined, vectors.get(id), 0.22 / positiveArticles.size);
        for (const id of negativeArticles) addVector(combined, vectors.get(id), -0.12 / negativeArticles.size);
        const norm = Math.sqrt(dot(combined, combined)) || 1;
        return new Map([...vectors].map(([id, vector]) => [id, dot(vector, combined) / norm]));
      } catch {
        vectors = null;
        reason = 'Local semantic inference failed. Run npm run prepare:semantic to rebuild the cache.';
        return null;
      }
    },
  };
}

function addVector(target, source, weight) {
  if (!source) return;
  for (let i = 0; i < target.length; i++) target[i] += source[i] * weight;
}

function dot(first, second) {
  let score = 0;
  for (let i = 0; i < first.length; i++) score += first[i] * second[i];
  return score;
}
