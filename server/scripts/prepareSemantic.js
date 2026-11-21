import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/config/index.js';
import { groupArticles } from '../src/v3/retrievalArticles.js';
import { prepareArticleEmbeddings, SEMANTIC_MODEL } from '../src/v3/semantic.js';

try {
  const docs = JSON.parse(readFileSync(CONFIG.paths.corpusFile, 'utf8'));
  const { articles } = groupArticles(docs);
  console.log(`Preparing ${articles.length} article embeddings with ${SEMANTIC_MODEL}`);
  const file = await prepareArticleEmbeddings(articles, {
    progress(done, count) {
      if (done % 128 === 0 || done === count) console.log(`${done}/${count} articles encoded`);
    },
  });
  console.log(`Semantic cache saved to ${file}`);
} catch (error) {
  console.error(`Semantic preparation failed. ${error.message}`);
  if (error.cause) console.error(error.cause);
  process.exitCode = 1;
}
