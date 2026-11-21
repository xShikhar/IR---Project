import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG } from '../config/index.js';

const modelId = 'Xenova/ms-marco-MiniLM-L-6-v2';
const revision = 'a09144355adeed5f58c8ed011d209bf8ee5a1fec';
const modelDir = path.join(CONFIG.paths.dataDir, 'raw', 'reranker', revision);
const files = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];

async function prepareModel() {
  for (const file of files) {
    const target = path.join(modelDir, file);
    if (fs.existsSync(target)) continue;
    const response = await fetch(`https://huggingface.co/${modelId}/resolve/${revision}/${file}`);
    if (!response.ok) throw new Error(`Unable to download ${file} (HTTP ${response.status}).`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, Buffer.from(await response.arrayBuffer()));
      fs.renameSync(temp, target);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
  console.log(`Local passage reranker prepared at ${modelDir}`);
}

export function createReranker() {
  let encoder;
  let failure;
  const ready = files.every(file => fs.existsSync(path.join(modelDir, file)));

  async function load() {
    const { AutoTokenizer, AutoModelForSequenceClassification } = await import('@huggingface/transformers');
    const localPath = modelDir.replaceAll('\\', '/');
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(localPath, { local_files_only: true }),
      AutoModelForSequenceClassification.from_pretrained(localPath, {
        local_files_only: true, device: 'cpu', dtype: 'q8',
        session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 },
      }),
    ]);
    return { tokenizer, model };
  }

  return {
    status() {
      return {
        available: ready && !failure,
        model: modelId,
        reason: failure ?? (ready ? null : 'Run npm run prepare:reranker to enable passage reranking.'),
      };
    },
    async score(query, passages) {
      if (!ready || failure) return null;
      try {
        const { tokenizer, model } = await (encoder ??= load());
        const logits = [];
        for (let start = 0; start < passages.length; start += 8) {
          const text_pair = passages.slice(start, start + 8);
          const features = tokenizer(text_pair.map(() => query), {
            text_pair, padding: true, truncation: true, max_length: 256,
          });
          const output = await model(features);
          logits.push(...output.logits.data);
        }
        if (logits.length !== passages.length || !logits.every(Number.isFinite)) throw new Error('Invalid reranking scores.');
        return logits;
      } catch {
        failure = 'Local passage reranking failed. Check the model cache and optional Transformers.js dependency.';
        return null;
      }
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await prepareModel();
