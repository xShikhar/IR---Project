# TurnTrace 2 — Inspectable Conversational Passage Retrieval with Resumable Topics

**CSD358 Information Retrieval · Track T2 · Course project report**

[TurnTrace 2 source code](https://github.com/xShikhar/IR---Project)

## Abstract

Conversational passage retrieval must interpret short follow-ups, handle changes of topic, and make evidence available for scrutiny. TurnTrace 2 extends the midterm engine with resumable topic state, inspectable query weights, a configurable ranking ensemble, and corpus-backed clarification. A React workspace supports feedback, preview, and undo. On 40 TEST turns over 35,000 passages, nDCG@10 was 0.7255 for raw BM25, 0.6366 for the frozen midterm, 0.6978 for the new lexical hybrid, and 0.6984 for the full hybrid with local article embeddings. The two new configurations returned 14.75% and 16.00% unjudged results at rank 10, respectively. All four synthetic behavior cases passed. The comparison is exploratory, and the inherited AI-derived grades await human validation.

## 1. Introduction

“What about its mirror?” has limited meaning in isolation. After a query about the James Webb Space Telescope, the same utterance can retrieve evidence about a specific component. When a conversation moves to a new subject and later returns, carrying every prior query term mixes vocabularies and risks ranking the wrong passages. A useful search workspace must preserve enough history to recover the intended subject and expose which terms and signals drove each result.

TurnTrace 2 builds on the frozen TurnTrace midterm implementation at commit `d0022603ebd9181f21e0e406cfd4a2d72af79104`. It uses the same collection and preserves the original conversational engine as a baseline. The unit of output is a ranked passage with corpus text and scoring evidence. [Midterm source](https://github.com/xShikhar/IR---MidTerm-Assignment)

### Contributions

1. A session model with separately resumable topics, user-selected interpretations, and topic-scoped feedback.
2. Weighted lexical retrieval with term provenance, score evidence, optional redundancy reduction, and a workspace for comparing rankings from the same session state.
3. A reproducible three-system comparison that exposes coverage of inherited judgments and exports new candidates for blind review.

## 2. Related work

**Retrieval and fusion.** Robertson and Zaragoza [1] describe the probabilistic relevance framework and BM25's term-frequency saturation and length normalization. TurnTrace 2 applies query-side weights to a BM25 channel and combines it with a vector-space channel. Cormack, Clarke, and Büttcher [2] give a rank-based fusion rule that combines lists whose source scores have different scales. Carbonell and Goldstein [3] formulate Maximal Marginal Relevance as a trade-off between query relevance and redundancy with selected results. These methods motivate the hybrid and its optional diversity control. [BM25](https://doi.org/10.1561/1500000019) · [Reciprocal Rank Fusion](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf) · [Maximal Marginal Relevance](https://www.cs.cmu.edu/afs/cs/Web/People/jgc/publication/MMR_DiversityBased_Reranking_SIGIR_1998.pdf)

**Conversational query resolution and clarification.** TREC CAsT [4] established a multi-turn passage retrieval task in which dialogue history helps specify the current need. Voskarides et al. [5] model historical term selection with a learned classifier and identify topic return as a challenge for query resolution. TurnTrace 2 uses explicit topic state and corpus features. Aliannejadi et al. [6] introduce an evaluation task and crowdsourced data for selecting clarifying questions. Their work motivates the ability to ask a user to choose a sense in a local collection. [TREC CAsT](https://trec.nist.gov/pubs/trec28/papers/OVERVIEW.CAsT.pdf) · [QuReTeC](https://arxiv.org/abs/2005.11723) · [Qulac](https://arxiv.org/abs/1907.06554)

**Pooled evaluation.** Buckley and Voorhees [7] show that standard retrieval metrics can become unreliable when judgments are substantially incomplete. Ranking coverage is therefore part of each system's reported result, and the reproducible pool identifies which passages require additional judgments. [Retrieval Evaluation with Incomplete Information](https://www.nist.gov/publications/retrieval-evaluation-incomplete-information)

| Design dimension | QuReTeC [5] | TurnTrace 2 |
| --- | --- | --- |
| Context resolution | Classifies terms from prior utterances for inclusion in the current query. | Routes to a reusable topic and assigns weights to terms from the current query, topic, and feedback. |
| Supervision | Trains a transformer term classifier and studies distant supervision from relevance judgments. | Uses fixed session rules and lexical scoring, with an optional pretrained semantic encoder. |
| Interaction and evidence | Studies multi-turn query resolution and evaluates ranked passages on established conversational collections. | Lets users choose a corpus-backed sense, preview a ranking, and inspect term provenance and passage scores. |

The comparison describes the architectures. The projects use different collections and protocols, so the QuReTeC paper's scores are outside the experimental comparison below. [QuReTeC paper](https://arxiv.org/abs/2005.11723)

## 3. Objectives

- Preserve the subject of a follow-up, support an explicit switch, and restore the original topic when it returns.
- Show the impact of current query terms, topic terms, and explicit user signals on ranked passages.
- Ask actionable clarification when the corpus supplies competing senses.
- Measure the resulting lexical ranking under the inherited evaluation protocol while reporting its judgment coverage.

## 4. Architecture and methodology

### Corpus and index

The frozen collection contains 35,000 English Wikipedia passages drawn from computing and AI, biology and medicine, history and civilization, and space and physics. Passages retain stable IDs, titles, body text, and domain. The inherited normalizer and Porter stemmer produce lexical terms. The inverted index stores document frequency, term position and zone counts, document lengths, and passage metadata. The same index supplies statistics to all three evaluated systems.

### Session, retrieval, and evidence

```text
React workspace
  → Node API and session topic selection
  → Weighted query built from current terms, topic state, and feedback
  → Indexed BM25 and cosine rankings
  → Rank fusion, feedback adjustments, optional diversity
  → Evidence passages and explanation trace
```

The React client sends a raw query and session ID to the Node API. The workspace resolves a topic through signals in the new query and existing session topics. A topic stores entity and aspect terms, along with passage feedback. The user can also select an existing topic. Candidate interpretations come from article identities in the loaded corpus. The session records a turn after an ambiguity is resolved or the search can proceed. Preview and comparison operate on a copy of context so the user can inspect alternatives before committing a new turn.

The search service weights each current term by 1.00 and each topic entity term by 0.85, adding contributions when sources overlap. Brief elaboration requests such as ?Tell me more? carry up to four aspect terms from the latest substantive turn in the active topic. Each carried term receives a weight of 0.40 and cites its source turn in the inspector. Users can remove those terms in a ranking preview. Relevant passages can contribute up to eight expansion terms with weight 0.35 each. The lexical hybrid uses weighted BM25 and cosine, with a raw-query recovery channel when context contributes. The full hybrid also uses 384-dimensional article embeddings from the cached, quantized `Xenova/all-MiniLM-L6-v2` model. It compares the query embedding with 728 article vectors and projects article affinity to passage candidates. The response includes ranked passages, query-biased excerpts, score components, and term provenance.

### Ranking functions

Let `w(t)` be the effective query weight for term `t`, `f(t,d)` its zone-weighted frequency in passage `d`, `N` the passage count, and `df(t)` the number of passages containing `t`. Weighted BM25 uses the following term contribution, summed over effective query terms.

```text
idf_BM25(t) = ln(1 + (N − df(t) + 0.5) / (df(t) + 0.5))
lengthNorm(d) = 1 − b + b · length(d) / averageLength
termBM25(t,d) = w(t) · idf_BM25(t) · f(t,d) · (k1 + 1)
                / (f(t,d) + k1 · lengthNorm(d))
```

The passage term frequency is 1.2 times the title count plus the body count, with index term frequency as the fallback. BM25 uses `k1 = 1.2` and `b = 0.75`. The cosine channel combines a normalized weighted tf–idf query with logarithmic document term frequency divided by the stored document norm. Hybrid fusion uses `k = 20` and channel weights of 1.00 for BM25, 0.65 for cosine, 0.20 for raw-query recovery, and 0.75 for the optional semantic ranking. Here `r(j,d)` is the one-based rank of passage `d` in channel `j`. Missing passages contribute zero.

```text
cosine(q,d) = sum over t of (w(t) · idf(t) / ||q||₂)
                           · ((1 + ln(f(t,d))) / storedNorm(d))
fused(d) = sum over participating channels j of a(j) / (k + r(j,d))
```

With diversity enabled, an MMR-style step uses 0.60 times normalized relevance minus 0.40 times the maximum similarity to an already selected passage. The similarity combines lexical overlap with a same-article penalty. Both TurnTrace 2 configurations use the default best-match order with diversity off in this benchmark. Pinned evidence is given explicit priority.

## 5. Experiments

The inherited benchmark has 14 conversations and 70 turns with an 8-conversation, 40-turn TEST split and a 6-conversation, 30-turn DEV split. We compare four configurations on TEST at a common output depth of 20. The fixed qrels supply 1,283 AI-derived grades on TEST, with 0 for irrelevant, 1 for useful context, and 2 for a direct answer. The frozen AI-authored rewrites guided the inherited judging. Each retrieval configuration receives only the utterance and its own session state.

| System | Inputs and configuration |
| --- | --- |
| Raw BM25 | Current utterance, raw-query BM25 |
| Midterm TurnTrace | Current utterance and independent v2 ContextState for each dialogue, with the frozen entry point's default cosine, entity lock, and fusion |
| TurnTrace 2 lexical hybrid | Current utterance and independent topic state for each dialogue, with lexical hybrid ranking |
| TurnTrace 2 full hybrid | Same inputs and session rules, with the local article embedding channel added to the hybrid |

The systems receive the same utterances in chronological order. An ambiguous query contributes its immediate results to the fixed benchmark. The inherited dialogue provides no interactive choice or explicit feedback. The runner also exercises a telescope-to-CRISPR-to-telescope return, a choice of the chemical element for Mercury, and pin feedback with preview and undo using separate synthetic expectations.

For a turn, `g_i` denotes the available relevance grade at rank `i`. A missing grade gives zero gain for ranking calculations. Precision uses the fixed cutoff as its denominator. `IDCG@10` is DCG on the ideal order of the available judgments.

```text
P@k = count of grade ≥ 1 in the top k / k
DCG@10 = sum from i=1 to 10 of (2^g_i − 1) / log2(i + 1)
nDCG@10 = DCG@10 / IDCG@10
RR@20 = 1 / first rank with grade ≥ 1 in the top 20, or 0 if none
Known recall@20 = retrieved grade ≥ 1 in top 20 / all judged grade ≥ 1
Unjudged@10 = unjudged results in the top 10 / results returned in the top 10
```

The table averages these metrics over eligible turns, with MRR@20 averaging RR@20. The available judgments determine the ideal ranking and known-recall denominator. Unjudged@10 uses only result lists with at least one returned passage.

## 6. Results

The default TEST figures come from `npm run eval:v3`, and the full hybrid figures come from `npm run eval:v3 -- --semantic`. The baseline and lexical figures matched between the two runs. The table reports means across the same 40 TEST turns. [Default run](../eval/output/v3/summary.json) · [Semantic comparison](../eval/output/v3/semantic/summary.json) · [Reproduction guide](EVALUATION.md)

| Configuration | P@5 | P@10 | nDCG@10 | MRR@20 | Known R@20 | Unjudged@10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Raw BM25 | 0.8800 | 0.8525 | 0.7255 | 0.9625 | 0.4993 | 0.00% |
| Midterm TurnTrace | 0.8950 | 0.8650 | 0.6366 | 0.9375 | 0.5106 | 0.50% |
| TurnTrace 2 lexical hybrid | 0.8800 | 0.8125 | 0.6978 | 0.9800 | 0.5340 | 14.75% |
| TurnTrace 2 full hybrid | 0.8700 | 0.8100 | 0.6984 | 0.9633 | 0.5334 | 16.00% |

Raw BM25 led the measured nDCG@10, and the midterm led P@10. The lexical hybrid had the highest MRR@20 and returned the greatest share of known relevant passages at depth 20. Adding the semantic channel changed nDCG@10 by +0.0006 relative to the lexical hybrid in this run. Raw BM25 had 0 unjudged hits out of 400 top-ten passages, the midterm had 2, the lexical hybrid had 59, and the full hybrid had 64. The coverage imbalance limits conclusions about relative relevance. The four-system run exported 83 distinct unjudged turn–passage pairs for review.

**Turn-level analysis.** On the Library of Alexandria follow-up “Who founded it and when?” (`conv_08_turn_02`), the lexical hybrid kept the library topic and scored 0.7697 nDCG@10 versus 0.0000 for raw BM25 and 0.8430 for the midterm. On “What is the James Webb Space Telescope?” (`conv_03_turn_01`), the lexical hybrid scored 0.2942 versus 1.0000 for both baselines. Six of its first ten results lack judgments. This case shows how a ranking can preserve the intended topic and still score poorly on the available pool. [Per-turn rankings](../eval/output/v3/semantic/per_turn.csv)

**Behavior evaluation.** All four synthetic cases passed in the lexical configuration. The telescope topic reused its original ID after the CRISPR turn. Mercury offered the element and planet choices and ranked the chosen element first. A pinned passage led the preview, preview preserved session state, and undo removed the pin. In the elaboration case, inheriting the mirror aspect changed the BM25 ranking. Removing the term reproduced the ranking from the same configuration with aspect history disabled. This test establishes that the term affects scoring. It measures behavior on a designed scenario without providing a general estimate of retrieval gains. These checks provide evidence for the implemented interactions alongside the separate ranking measurements.

## 7. Limitations and next validation

- The corpus covers four subject areas and the TEST split contains eight dialogues. The result estimates performance on this curated collection and split.
- We inspected TEST rankings while diagnosing false topic switches and reran the comparison after correcting topic routing. The reported results are exploratory. A separate, untouched conversational collection is needed to assess generalization.
- The midterm describes the inherited grades as LLM-judged, and its archived judging script encodes a deterministic rubric. The original pool included raw BM25. Differences in how many passages received judgments can affect measured nDCG as well as reflect differences in ranking.
- The synthetic cases test specified interactions on familiar topics. They provide no population estimate for topic detection, clarification quality, or user benefit.
- Topic association relies on lexical and corpus identity cues. During development, incidental title overlap diverted a Library of Alexandria follow-up to Museum of Work. The final routing kept the library topic on that turn. The optional semantic channel uses article vectors, so differences between passages within an article are represented by lexical evidence.
- A subsequent validation should give independent reviewers the blinded unjudged pool, measure agreement, and adjudicate disagreements before rerunning the comparison. A separate user study would be needed to compare workflow outcomes.

## 8. References

1. Robertson, S., and Zaragoza, H. (2009). *The Probabilistic Relevance Framework: BM25 and Beyond.* Foundations and Trends in Information Retrieval, 3(4), 333–389. [Publisher](https://doi.org/10.1561/1500000019)
2. Cormack, G. V., Clarke, C. L. A., and Büttcher, S. (2009). *Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods.* SIGIR, 758–759. [Paper](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf)
3. Carbonell, J., and Goldstein, J. (1998). *The Use of MMR, Diversity-Based Reranking for Reordering Documents and Producing Summaries.* SIGIR, 335–336. [Paper](https://www.cs.cmu.edu/afs/cs/Web/People/jgc/publication/MMR_DiversityBased_Reranking_SIGIR_1998.pdf)
4. Dalton, J., Xiong, C., and Callan, J. (2019). *CAsT 2019: The Conversational Assistance Track Overview.* TREC 2019. [NIST proceedings](https://trec.nist.gov/pubs/trec28/papers/OVERVIEW.CAsT.pdf)
5. Voskarides, N., Li, D., Ren, P., Kanoulas, E., and de Rijke, M. (2020). *Query Resolution for Conversational Search with Limited Supervision.* SIGIR, 921–930. [Paper](https://arxiv.org/abs/2005.11723)
6. Aliannejadi, M., Zamani, H., Crestani, F., and Croft, W. B. (2019). *Asking Clarifying Questions in Open-Domain Information-Seeking Conversations.* SIGIR, 475–484. [Paper](https://arxiv.org/abs/1907.06554)
7. Buckley, C., and Voorhees, E. M. (2004). *Retrieval Evaluation with Incomplete Information.* SIGIR, 25–32. [NIST publication](https://www.nist.gov/publications/retrieval-evaluation-incomplete-information)
