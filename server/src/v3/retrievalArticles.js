import { analyze, removeDiacritics } from '../index/normalizer.js';

export function canonicalTitle(title) {
  return title.replace(/\s+[-–—]\s+(?:section|part|passage)\s+\d+\s*$/iu, '').trim();
}

export function articleId(title, domain) {
  const slug = removeDiacritics(canonicalTitle(title)).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return `article:${domain}:${slug}`;
}

const ARTICLE_QUERY_WORDS = new Set(analyze('tell please explain describe define give mean meaning definition information overview work introduction introductory'));

export function groupArticles(docs) {
  const articles = new Map();
  const docToArticle = new Map();
  for (const doc of Object.values(docs)) {
    const title = canonicalTitle(doc.title);
    const id = articleId(title, doc.domain);
    if (!articles.has(id)) {
      const alias = title.replace(/\s*\([^()]+\)\s*$/u, '');
      articles.set(id, {
        id,
        title,
        aliasTerms: analyze(alias),
        titleTerms: analyze(title),
        terms: [...new Set(removeDiacritics(title).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])],
        docs: [],
      });
    }
    const article = articles.get(id);
    article.docs.push(doc);
    docToArticle.set(doc.docId, article);
  }

  const sorted = [...articles.values()].sort((first, second) => first.id.localeCompare(second.id, 'en'));
  for (const article of sorted) {
    article.docs.sort((first, second) => sectionNumber(first.title) - sectionNumber(second.title)
      || first.docId.localeCompare(second.docId, 'en'));
  }
  return { articles: sorted, docToArticle };
}

function sectionNumber(title) {
  return Number(title.match(/\s+[-–—]\s+(?:section|part|passage)\s+(\d+)\s*$/iu)?.[1] ?? 0);
}

export function createInterpretationLookup(articles) {
  const byFirstTerm = new Map();
  for (const article of articles) {
    const firstTerm = article.aliasTerms[0];
    if (!byFirstTerm.has(firstTerm)) byFirstTerm.set(firstTerm, []);
    byFirstTerm.get(firstTerm).push(article);
  }

  return function interpretations(query) {
    const terms = analyze(query).filter(term => !ARTICLE_QUERY_WORDS.has(term));
    if (!terms.length) return [];

    const matches = (byFirstTerm.get(terms[0]) ?? []).filter(article => (
      article.aliasTerms.every((term, index) => terms[index] === term)
      && terms.every(term => article.titleTerms.includes(term))
    ));
    const longest = Math.max(0, ...matches.map(article => article.aliasTerms.length));
    return matches.filter(article => article.aliasTerms.length === longest)
      .sort((first, second) => first.title.localeCompare(second.title, 'en'))
      .slice(0, 5)
      .map(article => ({
        id: article.id,
        title: article.title,
        terms: article.terms.filter(term => analyze(term).length),
        docCount: article.docs.length,
        example: article.docs[0].body.trim().replace(/\s+/gu, ' ').slice(0, 180),
      }));
  };
}
