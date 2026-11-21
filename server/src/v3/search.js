import { CONFIG } from '../config/index.js';
import { analyze, removeDiacritics } from '../index/normalizer.js';
import { evaluatePhraseQuery } from '../retrieval/phrase.js';
import { computeTitleFilteredCandidates } from '../retrieval/titleFilter.js';
import { createInterpretationLookup, describeInterpretation, groupArticles } from './retrievalArticles.js';
import { createSemanticRetriever, SEMANTIC_MODEL } from './semantic.js';
import { createReranker } from './reranker.js';

const MODELS = new Set(['hybrid', 'bm25', 'cosine', 'semantic']);
const RRF_CONSTANT = 20;
const round = value => Number(value.toFixed(6));
const byScore = (first, second) => second.score - first.score || first.docId.localeCompare(second.docId, 'en');
const diagnosticDepth = 8;

const literalWords = value => removeDiacritics(value).toLowerCase().match(/[a-z0-9_]+/g) ?? [];
const phraseKey = words => ` ${words.join(' ')} `;

function quotedPhraseFilter(query, index) {
  const matches = [];
  let eligible;
  const phrases = new Set([...query.matchAll(/"([^"]+)"|“([^”]+)”/gu)].map(match => (match[1] ?? match[2]).trim()));
  for (const phrase of phrases) {
    const words = literalWords(phrase);
    if (!words.length) continue;
    const indexed = analyze(phrase);
    const positionsAvailable = indexed.length === words.length;
    const rarest = [...new Set(indexed)].sort((a, b) => (index.dictionary[a]?.df ?? 0) - (index.dictionary[b]?.df ?? 0))[0];
    const candidates = positionsAvailable
      ? evaluatePhraseQuery(indexed, index).map(entry => entry.docId)
      : rarest ? (index.dictionary[rarest]?.postings ?? []).map(entry => entry.docId) : Object.keys(index.docs);
    const literal = phraseKey(words);
    const ids = new Set(candidates.filter(id => {
      const doc = index.docs[id];
      return doc && [doc.title, doc.body].some(zone => phraseKey(literalWords(zone)).includes(literal));
    }));
    matches.push({
      phrase, strategy: positionsAvailable ? 'Positional intersection' : rarest ? 'Posting scan with stop words' : 'Text scan',
      candidates: candidates.length, matchingDocCount: ids.size,
      examples: [...ids].slice(0, 3).map(id => ({ id, title: index.docs[id].title })),
    });
    eligible = eligible ? new Set([...eligible].filter(id => ids.has(id))) : ids;
  }
  return { matches, eligible };
}

function documentTerms(doc) {
  return analyze(`${doc.title} ${doc.body}`);
}

function termWeights(index, current, entity, exemplars, excluded, history = []) {
  const weights = new Map();
  function add(terms, source, weight) {
    for (const term of terms) {
      if (!Object.hasOwn(index.dictionary, term) || (source !== 'current' && excluded.has(term))) continue;
      if (!weights.has(term)) weights.set(term, { term, weight: 0, sources: { current: 0, entity: 0, feedback: 0 } });
      const entry = weights.get(term);
      entry.sources[source] = (entry.sources[source] ?? 0) + weight;
      entry.weight += weight;
    }
  }
  add(new Set(current), 'current', 1);
  add(new Set(entity), 'entity', 0.85);
  for (const { term, sourceTurn } of history) {
    if (excluded.has(term) || !Object.hasOwn(index.dictionary, term) || weights.has(term)) continue;
    add([term], 'history', 0.4);
    weights.get(term).historyTurn = sourceTurn;
  }

  const salience = new Map();
  for (const doc of exemplars) {
    const counts = new Map();
    for (const term of documentTerms(doc)) counts.set(term, (counts.get(term) ?? 0) + 1);
    for (const [term, count] of counts) {
      const entry = Object.hasOwn(index.dictionary, term) ? index.dictionary[term] : null;
      if (!entry || /^\d+$/u.test(term) || term === 'section' || excluded.has(term)) continue;
      salience.set(term, (salience.get(term) ?? 0) + Math.log1p(count) * entry.bm25Idf);
    }
  }
  const expansion = [...salience].sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0], 'en'));
  for (const [term] of expansion.slice(0, 8)) add([term], 'feedback', 0.35);
  return weights;
}

function scoreLexical(index, terms, model, allowed) {
  const byDocument = new Map();
  const cosine = model === 'cosine';
  const { k1, b } = CONFIG.retrieval.bm25;
  const avgLength = index.metadata.avgDocLength || 1;
  const idf = term => index.dictionary[term].idf || index.dictionary[term].bm25Idf;
  const queryNorm = cosine ? Math.hypot(...[...terms.values()].map(item => item.weight * idf(item.term))) || 1 : 1;

  for (const item of terms.values()) {
    const entry = index.dictionary[item.term];
    const queryWeight = item.weight * (cosine ? idf(item.term) / queryNorm : entry.bm25Idf);
    for (const posting of entry.postings) {
      const doc = index.docs[posting.docId];
      if (!doc || !allowed(doc)) continue;
      const tf = (1.2 * posting.titleTf + posting.bodyTf) || posting.tf;
      const docWeight = cosine
        ? (1 + Math.log(tf)) / (doc.euclideanNorm || 1)
        : tf * (k1 + 1) / (tf + k1 * (1 - b + b * doc.docLength / avgLength));
      const contribution = queryWeight * docWeight;
      if (!byDocument.has(doc.docId)) byDocument.set(doc.docId, { docId: doc.docId, score: 0, terms: [] });
      const result = byDocument.get(doc.docId);
      result.score += contribution;
      result.terms.push({ ...item, contribution: round(contribution) });
    }
  }
  return [...byDocument.values()].sort(byScore);
}

function subjectConstraint(requested, topic, terms, excluded, index, articlesById, eligible) {
  const trace = { requested, effective: terms.length ? 'soft' : 'none', terms, subject: topic?.title ?? null };
  if (!terms.length) {
    return { trace: { ...trace, reason: 'No topic terms are active. Search covers the full eligible corpus.' } };
  }
  if (requested === 'soft') {
    return { trace: { ...trace, reason: 'Topic terms get extra weight across all eligible passages.' } };
  }
  const chosenArticle = !analyze((topic.entityTerms ?? []).join(' ')).some(term => excluded.has(term))
    ? articlesById.get(topic.interpretationId) : null;
  const titleMatches = chosenArticle
    ? new Set(chosenArticle.docs.map(doc => doc.docId))
    : computeTitleFilteredCandidates(terms.map(term => ({ term })), index, { lockMode: 'hard', minCandidates: 0 }).filteredDocIds;
  const scoped = new Set([...(titleMatches ?? [])].filter(id => eligible(index.docs[id])));
  const minimum = CONFIG.novelty.lock.minCandidates;
  const details = { ...trace, candidates: scoped.size, minimum, rule: chosenArticle ? 'Selected article' : 'All topic terms in title' };
  if (scoped.size < minimum) {
    return { trace: { ...details, effective: 'soft', fallback: true,
      reason: `Only ${scoped.size} passages met the lock and active filters. Using soft boost below ${minimum} candidates.` } };
  }
  return { allowedIds: scoped, trace: { ...details, effective: 'hard',
    reason: chosenArticle ? 'Every retrieval path is restricted to the selected article.' : 'Every retrieval path requires all topic terms in the passage title.' } };
}

function makeDocFilter(domain, exclusions, irrelevant) {
  const memo = new Map();
  return doc => {
    if (!doc || (domain && doc.domain !== domain) || irrelevant.has(doc.docId)) return false;
    if (!exclusions.length) return true;
    if (!memo.has(doc.docId)) {
      const title = ` ${analyze(doc.title, false).join(' ')} `;
      const body = ` ${analyze(doc.body, false).join(' ')} `;
      memo.set(doc.docId, !exclusions.some(phrase => title.includes(phrase) || body.includes(phrase)));
    }
    return memo.get(doc.docId);
  };
}

function rankSemantic(articles, affinities, lexicalRows, allowed) {
  const lexicalScores = new Map(lexicalRows.map(row => [row.docId, row]));
  const candidates = [];
  for (const article of articles) {
    const affinity = affinities.get(article.id);
    if (!Number.isFinite(affinity)) continue;
    const docs = article.docs.filter(allowed);
    const maximum = Math.max(1e-6, ...docs.map(doc => lexicalScores.get(doc.docId)?.score ?? 0));
    for (const [position, doc] of docs.entries()) {
      const lexical = lexicalScores.get(doc.docId);
      const passageBonus = 0.08 * (lexical?.score ?? 0) / maximum + 0.025 / (position + 1);
      candidates.push({ docId: doc.docId, score: affinity + passageBonus, articleSimilarity: affinity, passageBonus, terms: lexical?.terms ?? [] });
    }
  }
  return candidates.sort(byScore);
}

function collectCandidates(channels, limit, relevant, pinned) {
  const candidates = new Map();
  function get(docId) {
    if (!candidates.has(docId)) candidates.set(docId, { docId, score: 0, paths: [], terms: [], feedbackBoost: 0, diversityPenalty: 0 });
    return candidates.get(docId);
  }

  for (const channel of channels) {
    for (const [position, row] of channel.rows.slice(0, limit).entries()) {
      const result = get(row.docId);
      const rank = position + 1;
      const contribution = channels.length === 1 ? row.score : channel.weight / (RRF_CONSTANT + rank);
      result.score += contribution;
      result.paths.push({
        origin: channel.origin, model: channel.model, rank, score: round(row.score),
        weight: channel.weight, contribution: round(contribution),
        ...(channel.origin === 'semantic' ? { articleSimilarity: round(row.articleSimilarity), passageBonus: round(row.passageBonus) } : {}),
      });
      if (!result.terms.length) result.terms = row.terms;
    }
  }

  const maxScore = Math.max(0, ...[...candidates.values()].map(row => row.score));
  for (const docId of relevant) {
    const result = candidates.get(docId);
    if (!result) continue;
    result.feedbackBoost = maxScore * 0.1;
    result.score += result.feedbackBoost;
  }
  for (const docId of pinned) get(docId).pinned = true;
  const regular = [...candidates.values()].filter(item => !item.pinned).sort(byScore);
  return { fixed: pinned.map(id => candidates.get(id)), regular };
}

function selectDiverse(fixed, regular, index, docToArticle, limit) {
  const selected = fixed.slice(0, limit);
  const termsByDoc = new Map();
  const bestScore = Math.max(regular[0]?.orderScore ?? regular[0]?.score ?? 0, 1e-6);
  function terms(docId) {
    if (!termsByDoc.has(docId)) termsByDoc.set(docId, new Set(documentTerms(index.docs[docId])));
    return termsByDoc.get(docId);
  }
  function similarity(first, second) {
    const firstTerms = terms(first);
    const secondTerms = terms(second);
    const overlap = [...firstTerms].filter(term => secondTerms.has(term)).length;
    const lexical = overlap / (firstTerms.size + secondTerms.size - overlap || 1);
    return Math.max(lexical, docToArticle.get(first) === docToArticle.get(second) ? 0.9 : 0);
  }

  while (selected.length < limit && regular.length) {
    let best = -Infinity;
    let bestIndex = 0;
    let bestPenalty = 0;
    for (const [position, row] of regular.entries()) {
      const penalty = 0.4 * Math.max(0, ...selected.map(other => similarity(row.docId, other.docId)));
      const merit = 0.6 * (row.orderScore ?? row.score) / bestScore - penalty;
      if (merit <= best) continue;
      best = merit;
      bestIndex = position;
      bestPenalty = penalty;
    }
    const [next] = regular.splice(bestIndex, 1);
    next.diversityPenalty = bestPenalty;
    selected.push(next);
  }
  return selected;
}

function extractSnippet(body, terms) {
  const source = body.trim();
  const limit = 260;
  const sentenceMatches = [...source.matchAll(/[^.!?\n]+[.!?]*/gu)];
  let best;
  let bestScore = 0;
  for (const sentence of sentenceMatches) {
    const score = [...new Set(analyze(sentence[0]))].reduce((sum, term) => sum + (terms.get(term)?.weight ?? 0), 0);
    if (score <= bestScore) continue;
    best = sentence;
    bestScore = score;
  }
  let first = best?.index ?? 0;
  if (best?.[0].length > limit) {
    const focus = [...best[0].matchAll(/[\p{L}\p{N}]+/gu)].reduce((highest, word) => {
      const weight = terms.get(analyze(word[0])[0])?.weight ?? 0;
      return weight > highest.weight ? { weight, offset: word.index } : highest;
    }, { weight: 0, offset: 0 });
    first += Math.max(0, focus.offset - Math.floor(limit / 3));
  }
  let end = Math.min(source.length, first + limit);
  if (source.length - first < limit && first > 0) first = Math.max(0, end - limit);
  if (first > 0 && /\S/u.test(source[first - 1]) && /\S/u.test(source[first])) {
    const space = source.indexOf(' ', first);
    if (space >= 0 && space < end) first = space;
  }
  if (end < source.length && /\S/u.test(source[end])) {
    const space = source.lastIndexOf(' ', end);
    if (space > first) end = space;
  }
  const fragment = source.slice(first, end).trim();
  const words = fragment.match(/[\p{L}\p{N}]+/gu) ?? [];
  return {
    snippet: `${first > 0 ? '…' : ''}${fragment}${end < source.length ? '…' : ''}`,
    highlights: [...new Set(words.filter(word => analyze(word).some(term => terms.has(term))))].slice(0, 20),
  };
}

export function createSearchService(index, { semantic = true, semanticCacheDir } = {}) {
  const { articles, docToArticle } = groupArticles(index.docs);
  const articlesById = new Map(articles.map(article => [article.id, article]));
  const interpretations = createInterpretationLookup(articles);
  const neural = semantic ? createSemanticRetriever(articles, semanticCacheDir) : null;
  const reranker = createReranker();
  const semanticStatus = () => neural?.status() ?? {
    available: false, model: SEMANTIC_MODEL, granularity: 'article', reason: 'Semantic retrieval is disabled.', articleCount: 0,
  };

  return {
    interpretations,
    discoverInterpretations(mention) {
      const tokens = [...new Set(analyze(mention))];
      if (!tokens.length) return [];
      const direct = interpretations(mention);
      if (direct.length >= 2) return direct;
      const weights = termWeights(index, tokens, [], [], new Set());
      if (weights.size < tokens.length) return direct;
      const choices = new Map(direct.map(option => [option.id, option]));
      const matches = scoreLexical(index, weights, 'bm25', () => true);
      for (const match of matches) {
        if (match.terms.length !== tokens.length) continue;
        const article = docToArticle.get(match.docId);
        if (!article || choices.has(article.id)) continue;
        const source = tokens.every(token => article.titleTerms.includes(token)) ? 'Related title' : 'Passage mentions term';
        const doc = index.docs[match.docId];
        const option = describeInterpretation(article, source, doc);
        option.example = extractSnippet(doc.body, weights).snippet || option.example;
        choices.set(article.id, option);
        if (choices.size >= 6) break;
      }
      return [...choices.values()];
    },
    status: () => ({ semantic: semanticStatus(), reranker: reranker.status(), articleCount: articles.length, documentCount: docToArticle.size }),
    async search(query, options = {}) {
      const {
        model = 'hybrid', topK = CONFIG.retrieval.topK, topic, feedback = {},
        excludedTerms = [], excludedPhrases = [], diversity = false, domain = null, history = [],
        rerank = 'off', rawRecovery = true, seenDocIds = [], topicLock = 'soft',
      } = options;
      if (typeof query !== 'string') throw new TypeError('query must be a string');
      if (!MODELS.has(model)) throw new RangeError('Unknown retrieval model');
      if (!['soft', 'hard'].includes(topicLock)) throw new RangeError('Unknown topic lock mode');
      if (!Number.isInteger(topK) || topK < 1 || topK > 100) throw new RangeError('topK must be an integer from 1 to 100');
      const timings = {};
      const started = performance.now();
      const timed = (stage, start) => { timings[stage] = Number(((timings[stage] ?? 0) + performance.now() - start).toFixed(2)); };
      const irrelevant = new Set(feedback.irrelevant ?? []);
      const exclusions = excludedPhrases.map(phrase => analyze(phrase, false).join(' ')).filter(Boolean).map(phrase => ` ${phrase} `);
      const excluded = new Set(excludedTerms.flatMap(phrase => [phrase.toLowerCase(), ...analyze(phrase)]));
      const phraseFilter = quotedPhraseFilter(query, index);
      const allowedBySettings = makeDocFilter(domain, exclusions, irrelevant);
      const eligible = doc => (!phraseFilter.eligible || phraseFilter.eligible.has(doc?.docId)) && allowedBySettings(doc);
      const current = analyze(query);
      const entityText = (topic?.entityTerms ?? []).join(' ');
      const entity = analyze(entityText).filter(term => !excluded.has(term));
      const subject = subjectConstraint(topicLock, topic, [...new Set(entity)], excluded, index, articlesById, eligible);
      const allowed = doc => (!subject.allowedIds || subject.allowedIds.has(doc?.docId)) && eligible(doc);
      const relevant = [...new Set(feedback.relevant ?? [])].filter(id => Object.hasOwn(index.docs, id) && allowed(index.docs[id]));
      const pinned = [...new Set(feedback.pinned ?? [])].filter(id => Object.hasOwn(index.docs, id) && allowed(index.docs[id]));
      const weighted = termWeights(index, current, entity, relevant.map(id => index.docs[id]), excluded, history);
      const raw = termWeights(index, current, [], [], excluded);
      const hasContext = [...weighted.values()].some(item => item.sources.entity || item.sources.feedback || item.sources.history);
      const limit = Math.max(hasContext && !current.some(term => entity.includes(term)) ? 60 : 40, topK * 4);
      const channels = [];
      const lexicalModel = model === 'cosine' ? 'cosine' : 'bm25';
      timed('queryPreparation', started);
      let phase = performance.now();
      const lexical = scoreLexical(index, weighted, lexicalModel, allowed);
      const cosine = model === 'hybrid' ? scoreLexical(index, weighted, 'cosine', allowed) : null;
      timed('lexicalScoring', phase);
      const articleIds = ids => new Set(ids.map(docId => docToArticle.get(docId)?.id).filter(Boolean));
      const positiveArticles = articleIds(relevant);
      const negativeArticles = articleIds([...irrelevant]);
      for (const id of positiveArticles) negativeArticles.delete(id);

      const canUseNeural = neural && (model === 'hybrid' || model === 'semantic');
      const filteredEntity = entityText.replace(/[\p{L}\p{N}]+/gu, word => (
        analyze(word).some(term => excluded.has(term)) ? ' ' : word
      )).trim();
      const neuralQuery = query.trim() || filteredEntity;
      phase = performance.now();
      const affinities = canUseNeural && neuralQuery
        ? await neural.rank(neuralQuery.slice(0, 900), filteredEntity, positiveArticles, negativeArticles)
        : null;
      let effectiveModel = model;
      if (model !== 'semantic' || !affinities) {
        channels.push({ origin: hasContext ? 'context' : 'raw', model: lexicalModel, weight: 1, rows: lexical });
        if (cosine) channels.push({ origin: hasContext ? 'context' : 'raw', model: 'cosine', weight: 0.65, rows: cosine });
      }
      if (affinities) {
        channels.push({ origin: 'semantic', model: 'semantic', weight: model === 'hybrid' ? 0.75 : 1, rows: rankSemantic(articles, affinities, lexical, allowed) });
      } else if (model === 'semantic') {
        effectiveModel = 'bm25';
      } else if (model === 'hybrid') {
        effectiveModel = 'lexical-hybrid';
      }
      if (canUseNeural && neuralQuery) timed('semanticSearch', phase);
      phase = performance.now();
      if (rawRecovery && (hasContext || model === 'semantic' && affinities) && raw.size) {
        channels.push({ origin: 'raw', model: lexicalModel, weight: 0.20, rows: scoreLexical(index, raw, lexicalModel, allowed) });
        timed('lexicalScoring', phase);
      }
      if (phraseFilter.eligible?.size && !channels.some(channel => channel.rows.length)) {
        channels.splice(0, channels.length, {
          origin: 'phrase', model: 'phrase', weight: 1,
          rows: [...phraseFilter.eligible].filter(id => allowed(index.docs[id])).sort()
            .map(docId => ({ docId, score: 1, terms: [] })),
        });
        effectiveModel = 'phrase';
      }

      phase = performance.now();
      const { fixed, regular } = collectCandidates(channels, limit, relevant, pinned);
      const fusedCount = fixed.length + regular.length;
      const overlapCount = regular.filter(row => row.paths.length > 1).length + fixed.filter(row => row.paths.length > 1).length;
      timed('fusion', phase);
      const reranking = { ...reranker.status(), policy: rerank, evaluated: 0, elapsedMs: 0 };
      if (rerank !== 'off' && regular.length && reranking.available) {
        const started = performance.now();
        const semanticTop = new Set(channels.find(channel => channel.origin === 'semantic')?.rows.slice(0, 8).map(row => row.docId));
        const agreement = lexical.slice(0, 8).filter(row => semanticTop.has(row.docId)).length;
        const depth = rerank === 'adaptive' && agreement >= 4 ? 12 : 32;
        const candidates = regular.slice(0, depth);
        const context = [...entity, ...history.map(entry => entry.term)].join(' ');
        const resolvedQuery = [query.trim(), context].filter(Boolean).join(' ').slice(0, 600);
        const scores = await reranker.score(resolvedQuery, candidates.map(row => {
          const doc = index.docs[row.docId];
          return `${doc.title}. ${doc.body}`.slice(0, 1600);
        }));
        Object.assign(reranking, reranker.status(), { agreement, depth, elapsedMs: Math.round(performance.now() - started) });
        if (scores) {
          const byNeuralRank = candidates.map((row, position) => ({ row, position, logit: scores[position] }))
            .sort((a, b) => b.logit - a.logit || a.position - b.position);
          const byFusedRank = byNeuralRank.map(({ row, position, logit }, rank) => ({
            row, signal: 0.4 / (20 + position + 1) + 0.6 / (20 + rank + 1),
            explanation: { logit: round(logit), initialRank: position + fixed.length + 1, neuralRank: rank + 1 },
          })).sort((a, b) => b.signal - a.signal || a.explanation.initialRank - b.explanation.initialRank);
          const orderedScores = candidates.map(row => row.score);
          for (const [position, { row, explanation }] of byFusedRank.entries()) {
            row.reranking = explanation;
            row.orderScore = orderedScores[position];
          }
          regular.splice(0, candidates.length, ...byFusedRank.map(entry => entry.row));
          reranking.evaluated = candidates.length;
        }
        timed('reranking', started);
      }
      phase = performance.now();
      const selected = diversity
        ? selectDiverse(fixed, regular, index, docToArticle, topK)
        : [...fixed, ...regular].slice(0, topK);
      if (diversity) timed('diversity', phase);
      phase = performance.now();
      const seen = new Set(seenDocIds);
      const results = selected.map(row => {
        const { docId, title, body, domain: docDomain } = index.docs[row.docId];
        const origins = new Set(row.paths.map(item => item.origin));
        if (row.feedbackBoost || row.terms.some(item => item.sources.feedback > 0)) origins.add('feedback');
        if (row.pinned) origins.add('pinned');
        if (row.reranking) origins.add('reranked');
        return {
          docId, title, body, domain: docDomain, articleTitle: docToArticle.get(docId)?.title,
          previouslySeen: seen.has(docId),
          score: round(row.score), ...extractSnippet(body, weighted), origins: [...origins],
          breakdown: {
            scoringModel: channels.length > 1 ? 'Weighted reciprocal rank fusion' : channels[0]?.model ?? lexicalModel,
            rawScore: round(row.score - row.feedbackBoost),
            paths: row.paths,
            termContributions: row.terms,
            feedbackBoost: round(row.feedbackBoost),
            pinned: Boolean(row.pinned),
            diversityPenalty: round(row.diversityPenalty),
            ...(row.reranking ? { reranking: row.reranking } : {}),
          },
        };
      });
      timed('evidenceSnippets', phase);
      const postings = [...new Set(current.concat([...weighted.keys()]))].map(term => {
        const entry = index.dictionary[term];
        return { term, df: entry?.df ?? 0, idf: Number.isFinite(entry?.bm25Idf) ? round(entry.bm25Idf) : null };
      });
      return {
        results,
        trace: {
          rawQuery: query, model, requestedModel: model, effectiveModel, effectiveTerms: [...weighted.keys()],
          termWeights: [...weighted.values()], candidateDepth: limit,
          paths: channels.map(channel => ({ origin: channel.origin, model: channel.model, weight: channel.weight,
            candidates: Math.min(channel.rows.length, limit), scored: channel.rows.length,
            leaders: channel.rows.slice(0, diagnosticDepth).map(row => ({ docId: row.docId, title: index.docs[row.docId].title, score: round(row.score) })),
          })),
          postings,
          subjectLock: subject.trace,
          phraseMatches: phraseFilter.matches,
          phraseEligibleCount: phraseFilter.eligible?.size ?? null,
          fusion: { method: channels.length > 1 ? 'Weighted reciprocal rank fusion' : 'Single-channel ranking', rrfConstant: RRF_CONSTANT, fusedCount, overlapCount },
          novelty: { seenBefore: seen.size, repeated: results.filter(doc => doc.previouslySeen).length,
            newPassages: results.filter(doc => !doc.previouslySeen).length,
            distinctArticles: new Set(results.map(doc => docToArticle.get(doc.docId)?.id ?? doc.docId)).size,
            relevant: relevant.length, hidden: irrelevant.size, pinned: pinned.length, diversity },
          timings,
          filters: { domain, excludedTerms, excludedPhrases, irrelevant: [...irrelevant] }, semantic: semanticStatus(), reranking, diversity,
          returnedCount: results.length,
        },
      };
    },
  };
}
