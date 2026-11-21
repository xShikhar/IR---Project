# TurnTrace 2: complete project study guide

This study guide explains the implemented final project from first principles. It is intended to be enough reading material for a student who must run, demonstrate, explain, and defend the project. It describes the repository as inspected on 22 November 2026. Code is the authority when a historical report, a comment, or a feature idea differs from the implementation.

Read sections 1–8 to understand the system, sections 9–12 to demonstrate and evaluate it, and sections 13–16 to prepare oral answers. The numerical evaluation results are recorded artifacts, not new experiments conducted while writing this handbook. The verification counts are explicitly dated documented checks.

### Study route and contents

For first-time study, follow the numbered order. For a one-hour revision, read 1, 4–7, 10, 13, and 16, then rehearse the live sequence in 9.1. Use the questions in 14 to check whether you can explain the reasoning without reading an answer aloud.

1. [Project purpose](#1-what-the-project-does)
2. [IR foundations](#2-information-retrieval-from-the-beginning)
3. [Dataset and provenance](#3-dataset-provenance-and-what-is-frozen)
4. [Architecture and state](#4-architecture-and-ownership-of-state)
5. [Routing, meanings, and weights](#5-topic-routing-clarification-and-query-construction)
6. [Algorithms and worked examples](#6-ranking-algorithms-formulas-and-worked-examples)
7. [Inherited versus final implementation](#7-inherited-engine-versus-final-engine)
8. [Feature catalog and UI controls](#8-complete-feature-catalog-and-ui-controls)
9. [Eleven tours and presentation sequence](#9-demo-lab-all-eleven-actual-tours)
10. [Evaluation and honest interpretation](#10-evaluation-what-was-measured-and-what-it-means)
11. [Commands and troubleshooting](#11-running-reproducing-and-troubleshooting)
12. [Code and API map](#12-code-and-api-map-for-a-viva)
13. [Limitations and future work](#13-limitations-failure-analysis-and-future-work)
14. [Seventy questions and model answers](#14-likely-viva-questions-and-model-answers)
15. [Terminology and claims to avoid](#15-terminology-and-phrases-to-avoid)
16. [Last-minute cheat sheet](#16-last-minute-cheat-sheet)

## 1. What the project does

TurnTrace 2 is an **inspectable conversational passage retrieval workspace**. A user searches a frozen local collection of Wikipedia passages, asks follow-up questions, changes subjects, returns to earlier subjects, resolves ambiguous names, and adjusts the evidence ranking. The application exposes the terms, retrieval paths, feedback effects, and timing behind the results.

The output is ranked source passages. It is not a general chatbot that generates a new answer paragraph. For example, after “What is the James Webb Space Telescope?”, “Where is its orbit located?” contains no explicit telescope name. The workspace retains a telescope topic and supplies telescope terms to retrieval. If the user asks about CRISPR and then “Back to JWST, what instruments does it carry?”, it can resume the earlier telescope branch.

The central problem is **context management for search**. Carry too little context and pronouns become meaningless. Carry too much and old subjects contaminate new searches. Hide context and the user cannot correct a mistaken assumption. TurnTrace 2 combines separate topic memories with visible term weights and reversible ranking previews.

A useful thirty-second introduction is:

> We built TurnTrace 2 on our frozen midterm retrieval engine. It searches 35,000 Wikipedia passages and maintains separate resumable conversation topics. Users can choose a meaning, inspect weighted query terms and ranking evidence, give topic-specific feedback, and preview corrections without changing their saved conversation. The final pipeline combines lexical ranking with optional local article embeddings and passage reranking. Our contribution is the integrated, inspectable retrieval workflow; the ranking algorithms and pretrained models are established work.

### 1.1 Three meanings of “novelty”

In a project discussion, novelty means the contribution beyond the baseline: resumable topics, persisted interpretations, effective weights, correctable retrieval, and the comparison workflow. In a result trace, novelty means how many passages are new or repeated within a topic. In research, novelty may mean a new algorithm supported against the literature. These are different claims. This project primarily contributes an integration and interaction design, not the invention of BM25, RRF, MMR, or transformer models.

### 1.2 Why passage retrieval?

A passage is a smaller evidence unit than an entire article. A long article can discuss history, design, instruments, and controversies. Returning a focused passage helps a user inspect the part relevant to the current question. Several passages may share one article identity. That distinction matters because lexical ranking is passage-level while the dense semantic cache is article-level.

The collection is local and frozen. Searching it does not run a live Wikipedia or web search. A Wikipedia link on a result opens the source article, but it does not mean the displayed passage was fetched live. A good answer to an unsupported question is that the collection may not contain suitable evidence.

## 2. Information retrieval from the beginning

Information retrieval selects and orders documents for an information need. Here, a “document” in scoring code generally means one passage. A query is the user's search expression. A ranking is an ordered list of candidate passages. Relevance is whether a passage helps answer the question, judged in its conversational context.

**Precision** asks how much of what we returned is relevant. **Recall** asks how much relevant material we retrieved. A system can have high precision by returning a few excellent passages but low recall because it misses other useful evidence. Conversational retrieval adds the need to resolve “it”, “that”, “more”, and subject changes before ranking.

### 2.1 Tokens, normalization, and stems

The lexical pipeline strips diacritics, lowercases, tokenizes, removes stop words when appropriate, and applies the Porter stemmer. “Telescopes” and “telescope” can therefore match a common stem. A stop word is a frequent grammatical word such as “the”, “is”, or “its”. Removing it reduces noise for bag-of-words ranking. The raw query is still available to conversational rules, which can detect pronouns before their lexical importance disappears.

Stemming is a rule-based reduction, not full language understanding. It may overmerge different words or fail to merge synonyms. “Automobile” and “car” do not become identical merely because stemming is enabled. Semantic retrieval addresses some vocabulary mismatch, with the limitations explained later.

### 2.2 The inverted index

Scanning every passage for every query is unnecessary for lexical retrieval. An inverted index maps each term to a postings list of passages containing it. A posting includes passage ID, term frequency, title frequency, body frequency, and positions. The dictionary also stores document frequency and IDF values.

Imagine three documents:

```text
D1: webb telescope mirror
D2: hubble telescope orbit
D3: crispr gene editing

telescope -> D1, D2
mirror    -> D1
crispr    -> D3
```

A query about telescope mirrors needs the postings for `telescope` and `mirror`, not the body of every CRISPR passage. Document metadata supplies the title, body, domain, raw token length, and stored vector norm. The builder calculates average document length, vocabulary size, and total postings.

Title and body are separate zones. The index preserves their counts so a scorer can favor a title occurrence. Positions retain original token offsets even after stop-word removal. Body positions start after title positions plus a separation buffer of ten, preventing an accidental phrase match across the title/body boundary.

### 2.3 TF, DF, and IDF

Term frequency `tf(t,d)` counts occurrences of term `t` in document `d`. Document frequency `df(t)` counts documents containing it at least once. With `N` documents, the classical index IDF is `ln(N/df(t))`. A rare word is usually more discriminative than a word present almost everywhere.

If `N=100` and a term appears in ten documents, classical IDF is `ln(10) ≈ 2.303`. If another appears in fifty, its IDF is `ln(2) ≈ 0.693`. This is a collection statistic, not a factual truth score. A rare but irrelevant word can still mislead retrieval.

### 2.4 Boolean and phrase retrieval

Boolean AND intersects postings, OR unions them, and NOT takes a complement relative to available document IDs. For `A={D1,D2}` and `B={D2,D3}`, AND gives `{D2}`, OR gives `{D1,D2,D3}`, and NOT A excludes D1 and D2. The inherited Boolean implementation intersects the shortest lists first by increasing DF. This reduces intermediate work without changing the exact AND result. Entity constraints try AND and use OR if AND is empty.

Boolean functions are inherited building blocks. The final Search model selector does not expose a general Boolean query-language parser. Do not promise arbitrary nested Boolean syntax from that box. The midterm decomposer uses Boolean entity constraints internally.

A phrase requires word order and adjacency. If `space` occurs at position 4 and `telescope` at 5 in the same document, “space telescope” can match. Positions 4 and 9 do not match an exact phrase. The final quoted-phrase path also verifies the literal normalized word sequence within a title or a body. If stop words make direct positional matching unsuitable, it scans candidates from a rare term's postings; an all-stop-word phrase can require a text scan. Multiple quoted phrases are intersected. This is a real eligibility constraint in the final search path, rather than only a trace annotation.

### 2.5 Related-work primer: nine references and our relationship to them

These are the nine works cited in the project report. This primer explains their role; it does not claim their experiments were reproduced. Links are provided for further reading, while the necessary project comparison is explained here.

1. **Robertson and Zaragoza (2009), The Probabilistic Relevance Framework: BM25 and Beyond.** Supplies the probabilistic retrieval foundation behind BM25, including saturation and length normalization. Our implementation uses BM25 as an established lexical channel and adds explicit query-source weights. The paper is a methodological source, not a system we outperform. [Reference](https://doi.org/10.1561/1500000019)
2. **Cormack, Clarke, and Büttcher (2009), Reciprocal Rank Fusion.** Studies merging ranked lists through reciprocal-rank contributions. Our final weighted channels use this rank-based idea with constant twenty; the inherited implementation uses sixty. Our contribution is the selected combination and inspectable application, not the fusion rule. [Reference](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf)
3. **Carbonell and Goldstein (1998), Maximal Marginal Relevance.** Introduces a relevance-versus-redundancy selection principle. Our optional MMR-style implementation uses lexical Jaccard and a same-article similarity floor, with .60/.40 relevance/redundancy weights. It is an adaptation, not a reproduction of every original experimental choice. [Reference](https://www.cs.cmu.edu/afs/cs/Web/People/jgc/publication/MMR_DiversityBased_Reranking_SIGIR_1998.pdf)
4. **Dalton, Xiong, and Callan (2019), TREC CAsT Overview.** Frames conversational passage retrieval as a multi-turn search task where later utterances depend on earlier context. It motivates our problem definition. Our fourteen-dialogue course collection is not the official CAsT collection, so its results are not directly comparable. [Reference](https://trec.nist.gov/pubs/trec28/papers/OVERVIEW.CAsT.pdf)
5. **Voskarides and colleagues (2020), Query Resolution for Conversational Search with Limited Supervision, or QuReTeC.** Selects historical terms using a learned transformer classifier, with distant-supervision ideas. Our system instead uses explicit topic routing, fixed source weights, and user-visible corrections. Both address missing context; their supervision and user interactions differ. [Reference](https://arxiv.org/abs/2005.11723)
6. **Aliannejadi and colleagues (2019), Asking Clarifying Questions in Open-Domain Information-Seeking Conversations.** Provides a clarification research setting and crowdsourced data. It motivates asking for missing intent instead of always guessing. Our corpus-backed title choices and custom focus are simpler interactions; we neither train their question selector nor claim their clarification benchmark results. [Reference](https://arxiv.org/abs/1907.06554)
7. **Buckley and Voorhees (2004), Retrieval Evaluation with Incomplete Information.** Explains why incomplete relevance information complicates evaluation. It motivates reporting unjudged coverage and preparing additional blind pools. Coverage reporting diagnoses a limitation; it does not automatically correct the missing labels. [Reference](https://www.nist.gov/publications/retrieval-evaluation-incomplete-information)
8. **Nogueira and Cho (2019), Passage Re-ranking with BERT.** Provides the candidate-generation-then-joint-pair-scoring pattern. Our local MiniLM cross-encoder follows that two-stage approach, adding fixed/adaptive candidate budgets and trace evidence. It is a different model export, collection, and candidate set, so published numerical scores are not direct baselines here. [Reference](https://arxiv.org/abs/1901.04085)
9. **Reimers and Gurevych (2019), Sentence-BERT.** Explains sentence representation through separately usable embeddings and similarity, contrasting with jointly scoring every pair. This supports understanding our bi-encoder-style semantic channel. We use a pretrained MiniLM embedding model, not a newly trained Sentence-BERT model or a reproduction of the paper's benchmark. [Reference](https://aclanthology.org/D19-1410/)

A fair numerical comparison with a paper needs a common collection, split, judgments, candidate depth, and evaluation protocol, ideally a reproduced method. We can compare architectural ideas now, and compare raw BM25, the frozen midterm, and our configurations numerically on our shared inputs. We cannot subtract our nDCG from an unrelated paper's nDCG and call the difference an improvement.

## 3. Dataset, provenance, and what is frozen

The inherited corpus contains **35,000 English Wikipedia passages** across computing and AI, biology and medicine, history and civilization, and space and physics. Domain codes are `cs_ai`, `biology_medicine`, `history_civilization`, and `space_physics`. The final grouping produces **728 article groups**. Stable passage IDs connect the index, results, and relevance judgments.

The frozen domain totals are computing/AI 9,222; space/physics 9,266; biology/medicine 9,081; and history/civilization 7,431. These sum to 35,000; domain labels support filtering, not separate learned models.

The preparation script describes harvesting target Wikipedia articles and background Wikipedia material. The target list includes benchmark subjects such as BM25, JWST, CRISPR, Mercury, printing, and the Library of Alexandria. This is a curated educational collection, not a representative sample of all user interests. Corpus text is authentic source material; the conversations, grades, and synthetic checks have separate provenance.

The frozen baseline is the TurnTrace midterm at commit `d0022603ebd9181f21e0e406cfd4a2d72af79104`. The final project preserves its algorithms and historical artifacts. `npm run verify:data` checks the frozen data, while `npm run unpack:data` materializes the archived data when available. Rebuilding the corpus from network sources is not the same operation as reproducing an experiment on frozen inputs.

### 3.1 Conversations and judgments

There are **14 inherited dialogues and 70 turns**: six DEV conversations with 30 turns and eight TEST conversations with 40 turns. The TEST qrels contain **1,283 judged turn–passage pairs**, and every TEST turn has a positive judgment. A qrel is a relevance record keyed by the information need and passage, not a global label for that passage.

Grades are 0 for irrelevant, 1 for useful context, and 2 for a direct answer. The inherited judgments are AI-derived and have **no independent human validation**. The archived judging implementation uses deterministic rubric rules; the midterm also describes the judgments as LLM-judged. Preserve this provenance uncertainty rather than describing them as expert human ground truth.

Reference rewrites exist in the inherited conversation data for assessment. They express a resolved information need, for example replacing “its” with the telescope name. Runtime ranking does not read those rewrites. The demo conversation catalog deliberately exposes original questions without reference rewrites or expected labels. The evaluator uses qrels after producing rankings; it does not hand relevance grades to the search engine.

### 3.2 Why frozen data matters

If passages, IDs, index statistics, or qrels change between systems, a measured difference may reflect changed data rather than changed ranking. Frozen data makes comparisons reproducible. It does not make a biased or incomplete test set unbiased. Model revisions and embedding fingerprints add another reproducibility layer for the neural path.

Wikipedia attribution and source provenance remain relevant to the inherited corpus. Model files retain upstream metadata and licensing. AI assistance in implementation and documentation is disclosed separately from the origin of judgments and from human validation.

## 4. Architecture and ownership of state

```text
React/Vite workspace
    -> Express API /api/v3/
    -> session workspace: route topic, resolve meaning, assemble context
    -> search service: filters, weighted lexical and optional semantic paths
    -> fusion, feedback, optional cross-encoder, optional diversity
    -> ranked passages, snippets, score evidence, execution trace
```

The client is React. Vite supports development and builds production assets. Node/Express serves the API and, in production, the built client. Development uses client port 3100 and API port 3101; production normally serves both on 3101. The index is shared read-only retrieval data; topic memories belong to individual sessions.

### 4.1 Session and topic structures

A workspace holds session ID, active topic ID, topics, turns, and the next topic counter. Each topic holds ID, title, entity terms, optional interpretation ID, aspects, turn count, feedback, and creation time. Feedback consists of relevant, irrelevant, and pinned passage IDs. Each saved turn records the original query, topic, decision, result IDs, settings, and aspects.

This separates the **subject** from the **aspect**. In “What about its primary mirror?”, JWST is the subject and mirror is the aspect. A later CRISPR topic has its own subject and feedback. Selecting the telescope branch restores the telescope context without merging CRISPR vocabulary into it.

Sessions live in server memory, expire after six hours of inactivity, and are limited to 200 active sessions. A server restart clears them. Export downloads a JSON snapshot and retrieval/provenance metadata; it is not a database backup service with automatic restoration. Per-session promise queues serialize requests so overlapping mutations do not race within one workspace.

### 4.2 A complete request walkthrough

1. The client submits raw query, session ID, and controls.
2. The API validates query length, model, domain, flags, and identifiers.
3. The workspace clones the relevant state and determines CREATE, CONTINUE, RESUME, or CLARIFY.
4. If clarification is needed, it returns choices without committing a search turn.
5. Otherwise it assembles topic terms, eligible aspect history, and topic feedback.
6. The search service applies phrase, domain, irrelevant-document, and topic-scope constraints.
7. It calculates weighted lexical rankings and optionally article-semantic rankings and raw recovery.
8. It merges candidates, applies explicit feedback, optionally reranks and diversifies, and generates snippets.
9. A normal successful search commits the new turn. A preview discards the cloned changes.
10. The response supplies results and the evidence needed by the inspector.

This lifecycle explains why the same retrieval function can support normal searches, historical previews, methods comparisons, and context audits without silently adding turns.

## 5. Topic routing, clarification, and query construction

### 5.1 How topic routing actually works

The final router is rule-based. It builds a catalog of canonical article titles, title terms, bases without parenthetical senses, and acronyms. It looks for full title matches, base matches, acronyms, rare title terms, and sufficient title-term overlap. A full title receives a stronger score than a weak partial match. These are routing scores, not relevance probabilities.

It guards ordinary follow-ups from being mistaken for new subjects. Pronouns and “what/how about” indicate continuation; explicit switch language, recognized acronyms, named subjects, and definition-style queries can support a new subject. If an existing branch matches, the workspace resumes it. Otherwise it may create a new topic. A manually supplied topic ID has priority.

For example, `James Webb Space Telescope` establishes a branch. `Where is its orbit located?` normally continues it. `Explain CRISPR gene editing` introduces another indexed subject. `Back to JWST...` recognizes the acronym and resumes the old branch ID. This is lexical and corpus-supported routing, not a trained coreference resolver.

When there are multiple branches and a vague backward reference such as “that earlier one” cannot be resolved from an explicit subject, the workspace can ask which earlier topic the user means. The manual sidebar is also a correction mechanism when automatic routing is wrong.

### 5.2 Automatic and user-directed disambiguation

A bare ambiguous subject such as Mercury can produce several indexed article interpretations. The system groups competing senses by base title and asks the user to choose. Selecting Mercury (element) persists its article identity and terms. A subsequent question about the nervous system uses that confirmed subject.

Automatic clarification is deliberately narrower than “ask whenever two results have close scores.” It primarily handles bare indexed ambiguity and certain ambiguous backward references. A longer question may contain enough extra words to avoid that automatic trigger, even if a word inside it is ambiguous.

**Explore meanings** addresses that case. The user nominates a term independently of the current question. Suggestions first use indexed title/alias lookup; where appropriate, lexical matches supplement related titles and articles whose passages mention every nominated term. The interface labels “Indexed title”, “Related title”, and “Passage mentions term” separately and displays excerpts.

For “How does a transformer change voltage?”, explore `Transformer`, then choose the electrical article while retaining the original question. Alternatively choose “Search as written”, or supply a custom focus label and corpus keywords. A custom focus is explicit user input, not a machine-discovered dictionary meaning. Keywords must include indexed terms. No suggestions means the corpus cannot offer supported choices; the system does not fabricate senses.

### 5.3 Effective lexical weights

The final scorer consumes actual query weights:

| Source | Weight and rule |
| --- | --- |
| Current question | 1.00 for each distinct indexed term |
| Topic entity | 0.85 for each distinct active indexed subject term |
| Earlier aspect | 0.40, up to four terms, only for recognized brief elaboration |
| Relevant feedback expansion | 0.35, up to eight salient terms |

Contributions add when current, entity, and feedback sources overlap. A term appearing in both current question and topic receives 1.85 before any feedback contribution. History is added only if the term is not already present. Out-of-vocabulary terms do not produce postings-based scoring entries.

For a simplified query “Webb mirror”, suppose `webb` is both current and entity, `mirror` is current, and `space` is entity. We get `webb=1.85`, `mirror=1.00`, `space=0.85`. A later recognized “Tell me more” can carry `mirror=0.40` from the latest substantive turn in that topic. The trace records the source turn. It does not indiscriminately append every word from the entire conversation.

Feedback expansion ranks terms in relevant passages using `ln(1+count) × BM25-IDF`, sums salience across exemplars, excludes pure numbers and `section`, and takes up to eight. This is an explicit heuristic feedback method, not model training.

### 5.4 Aspect-history scope

Earlier aspects are inherited only for a recognizable elaboration pattern such as “Tell me more”, “Why?”, or “Elaborate”. The workspace finds the latest earlier turn in the active topic with substantive aspects. It carries at most four terms and records their origin. A new explicit question normally supplies its own aspect. This prevents unlimited stale-context accumulation but limits coverage of unusual elliptical language.

Removing an inherited chip affects a preview. Current question words are retained by the term-weight function even if an exclusion string names them; the correction control is designed around inherited context. A topic-word removal also affects topic restriction and the semantic subject text, rather than merely hiding a visual label.

## 6. Ranking algorithms, formulas, and worked examples

### 6.1 Weighted BM25

BM25 rewards matching discriminative terms, saturates repeated occurrences, and normalizes document length. The final v3 scorer uses `k1=1.2`, `b=0.75`, and zone frequency `f=1.2×titleTf+bodyTf`, falling back to stored total TF if necessary.

```text
idfB(t) = ln(1 + (N - df(t) + 0.5)/(df(t) + 0.5))
L(d) = 1 - b + b × length(d)/averageLength
BM25(q,d) = Σt w(t) × idfB(t) × f(t,d)(k1+1)/(f(t,d)+k1 L(d))
```

Let `N=100`, `df=10`, `length=averageLength`, `f=3`, and `w=1`. Then IDF is `ln(1+90.5/10.5)≈2.264`, length normalization is 1, and the TF factor is `3×2.2/(3+1.2)=1.571`. The contribution is about `3.558`. With weight 0.85 it becomes about `3.024`. At `f=30`, the TF factor is only `66/31.2≈2.115`: ten times the term count does not give ten times the score.

At twice average length, `L=0.25+0.75×2=1.75`. With `f=3`, the factor falls to `6.6/(3+2.1)≈1.294`. This corrects the tendency of long documents to contain more query words simply because they have more words. These are illustrative calculations, not scores copied from a particular corpus passage.

### 6.2 SMART-style cosine channel

The vector-space model represents queries and documents as term-weight vectors. Cosine measures alignment after normalization. In SMART notation, `lnc.ltc` means logarithmic TF, no document IDF, cosine normalization for documents; logarithmic TF, IDF, cosine normalization for queries.

The inherited index stores `norm(d)=sqrt(Σt(1+ln(rawTF(t,d)))²)`. The final weighted channel uses:

```text
idfC(t) = stored ln(N/df(t)), with BM25-IDF fallback when the stored value is zero
Q(t) = w(t) × idfC(t)
queryNorm = sqrt(Σt Q(t)²)
score(q,d) = Σt [Q(t)/queryNorm] × [(1+ln(f(t,d)))/storedNorm(d)]
```

For query components 3 and 4, the query norm is 5 and normalized weights are 0.6 and 0.8. If document components along those terms are 0.8 and 0.2, the dot-product contribution is `0.6×0.8+0.8×0.2=0.64`. Other document terms influence the stored norm even though they do not match the query.

An implementation qualification matters: the final scorer uses zone-weighted TF with the inherited stored norm calculated from raw TF. Describe it as a SMART-style weighted cosine channel using the stored norm; do not claim it is a freshly normalized unit vector under exactly the same zone transform. The midterm scorer has its own zone calculation, so identical model names do not imply identical scoring code.

### 6.3 Reciprocal rank fusion and raw recovery

BM25, cosine, and semantic similarity have different numeric scales. Weighted RRF combines ranks:

```text
F(d) = Σchannels j a(j)/(20 + rank(j,d))
```

The final hybrid weights are BM25 1.00, cosine 0.65, semantic 0.75 when available, and raw recovery 0.20 when applicable. A missing candidate contributes zero for that channel. A single channel retains its raw score rather than converting it into an RRF score.

If a passage ranks second in BM25 and fifth in cosine, its two-channel score is `1/22 + 0.65/25 = 0.07145`. Another passage ranked first only in BM25 receives `1/21≈0.04762`. Agreement can therefore outrank a single-channel leader. Adding a third-rank semantic contribution gives `0.75/23≈0.03261` more.

Raw recovery searches using the current utterance without inherited term weights, then contributes a small channel. It protects against contextual drift: an incorrect topic should not completely suppress direct query evidence. It is still subject to active eligibility filters and any applied hard lock; it is not an unrestricted escape from them.

Per-channel candidate depth is normally at least 40 and at least `4×topK`; some contextual cases raise the floor to 60. This is a fusion candidate limit, not a claim that only forty postings are scored. The trace separately reports scored rows and contributed candidates. API workspace results use ten; evaluation requests twenty.

### 6.4 Local semantic retrieval

The semantic encoder is pinned, quantized `Xenova/all-MiniLM-L6-v2`, executed on CPU through Transformers.js. It is pretrained; the project does not train or fine-tune it. Mean pooling and normalization produce 384-dimensional embeddings. Each of 728 article groups is represented by its title and up to 850 characters of combined text from the first two leading passages.

The cache therefore contains **728 article embeddings, not 35,000 passage embeddings**. Article-level representation reduces preparation and storage work, but it cannot fully represent every detail in a long article. Lexical passage evidence is used to distinguish passages inside a semantically promising article.

The semantic query combines vectors as follows:

```text
v = encode(current query)
    + 0.45 × encode(topic text)
    + 0.22 × mean(positive article vectors)
    - 0.12 × mean(negative article vectors)
articleAffinity(a) = dot(articleVector(a), v)/||v||
```

Unavailable components are omitted. An article marked both positively and negatively is removed from the negative set. Normalized article vectors make the final dot product a cosine-style affinity. For simple unit vectors `(1,0)` and `(0.8,0.6)`, similarity is 0.8; `(0,1)` has similarity 0. This illustrates alignment, not a probability of relevance.

For each allowed passage in an article, semantic ranking adds `0.08×passageLexicalScore/maxArticleLexicalScore + 0.025/(position+1)` to article affinity. The first bonus rewards a lexically relevant passage; the second slightly favors earlier sections. This projection is why the semantic path still returns passages even though the dense representation is article-level.

Preparation is the download boundary. Runtime uses local files only. Metadata checks model, revision, dimension, article count, file size, finite values, and a SHA-256 corpus fingerprint. A mismatched cache is rejected. Missing cache or failed inference produces an explicit lexical fallback. A semantic request can effectively become BM25; an unavailable neural hybrid becomes lexical hybrid. The UI and trace expose availability and effective model.

### 6.5 Local cross-encoder passage reranking

A bi-encoder embeds a query and item separately, permitting reusable item vectors. A cross-encoder jointly reads a query–passage pair and predicts a relevance logit, which costs more per candidate. TurnTrace 2 uses pinned pretrained `Xenova/ms-marco-MiniLM-L-6-v2`, locally on CPU, with quantized weights. It scores candidate pairs in batches of eight with tokenizer truncation at 256 tokens.

The resolved reranking query combines the original question with topic and inherited aspect terms, limited to 600 characters. Passage input contains title and body, limited to 1,600 characters before tokenization. Long passages may therefore lose evidence after truncation.

Policies are off, fixed, and adaptive. Fixed scores up to 32 non-pinned candidates. Adaptive counts overlap between the first eight lexical passages and the first eight semantic passages: **agreement ≥4 chooses depth 12; otherwise depth 32**. If there is no semantic list, agreement is zero, so adaptive takes the deeper budget when available. It is a deterministic agreement heuristic, not a learned uncertainty estimator.

The scored pool is ordered by:

```text
rerankSignal(d) = 0.4/(20+initialPoolRank) + 0.6/(20+crossEncoderRank)
```

A passage initially fifth but cross-encoder first receives `0.4/25+0.6/21≈0.04457`; a passage initially first but cross-encoder fifth receives `0.4/21+0.6/25≈0.04305`. The former wins. Pins stay ahead. Candidates outside the reranked prefix remain after that prefix.

The response retains original fused score fields and adds reranking metadata. Consequently a displayed fused score alone need not explain final order after reranking, pinning, or diversity. Inspect original rank, cross-encoder rank, logit, and policy. A logit is an uncalibrated model score, not a percentage confidence or verified truth.

### 6.6 Feedback and diversity

Relevant passages contribute expansion terms and, when already in the candidate set, receive an additive boost of 10% of the maximum pre-feedback candidate score. Marking relevant does not guarantee a document absent from all candidate lists will appear. Pinning explicitly inserts an allowed passage and places it first, in pin order. Marking irrelevant removes it from eligibility and unpins it. Pins still respect active filters and hard scope.

Diversity uses an MMR-style greedy selection:

```text
merit(d) = 0.60 × normalizedRelevance(d)
           - 0.40 × maxSimilarity(d, alreadySelected)
similarity = max(Jaccard(term sets), 0.9 if same article else 0)
Jaccard(A,B) = |A∩B|/|A∪B|
```

Suppose candidate A has normalized relevance 1 and similarity 0.9 to an already selected passage: merit is `0.60−0.36=0.24`. Candidate B has relevance 0.8 and similarity 0.1: merit is `0.48−0.04=0.44`. B is selected next. This may increase variety while lowering relevance on a narrowly focused question. Diversity is off by default and was off for the primary benchmark.

## 7. Inherited engine versus final engine

The preserved original API is `/api/chat`; the new workspace is `/api/v3/`. “v3” is an internal module/API name, while the product is TurnTrace 2. Do not describe them as three released final products.

The earliest inherited v1 path maintains a decayed bag of terms, uses a topic-shift heuristic, and appends selected history terms. Its context decay uses `0.75^age`. The midterm v2 path separates entity and aspect terms, uses CARRY/entity_switch/reset decisions, entity extraction supported by title hits, title filtering, query rewriting, decomposition, and optional seen-passage penalties.

The midterm decomposer recognizes comparison/conjunction patterns, creates lexical clause searches and a Boolean high-IDF entity search, and fuses results. Its RRF constant is **60**, distinct from the final hybrid's **20**. It also calculates normalized score-sum fusion for comparison. “Vector” in that inherited code means classical term-vector retrieval, not automatically neural embeddings.

Inherited champion lists keep a top subset per term, default 50, to reduce postings work. The rankers can fall back to full postings if too few candidates remain. Index elimination skips low-IDF query terms, with configured threshold 2.50. These are efficiency/quality trade-offs, not new final algorithms. The inherited seen penalty multiplies a previously shown passage's score by `1−0.30=0.70` when enabled.

The midterm clarifier based on result clusters is disabled by default because it failed to beat a trivial baseline on DEV. The final corpus-backed choice interface is a separate implementation. The final pipeline directly consumes numeric source weights instead of relying only on an appended query string.

The final engine does not automatically apply the inherited seen penalty. It labels previously seen passages and optionally applies diversity. The Compare view exposes inherited champion lists, index elimination, hard/soft entity lock, model, and seen penalty for the midterm replay. These switches do not silently alter the new weighted scorer.

One comparison qualification: the general interactive comparison defaults to enabling the inherited seen penalty, whereas the formal v3 evaluator invokes the frozen midterm entry point with its default settings and no explicit seen penalty. Match the recorded experiment configuration when quoting aggregate benchmark numbers.

## 8. Complete feature catalog and UI controls

Each entry states what the feature is, why it exists, how it works, what to show, and its practical boundary.

### 8.1 Navigation, topics, and workspace actions

**Search** is the main evidence workspace. **Demo lab** hosts guided tours. **Compare** hosts ranking, benchmark, and subject comparisons. **Experiments** displays saved measured results. The header shows corpus connectivity. It does not prove the optional neural models are loaded or establish relevance quality.

**New topic** prepares the next search as a separate branch. Topic buttons show titles, turn counts, and pin counts and allow explicit resumption. Show JWST and CRISPR branches and click between them. Automatic routing remains heuristic, so manual selection is an intentional correction path.

**Undo last change** restores a recent workspace snapshot. Searches, topic selection, and feedback are mutations with undo support; the stack holds up to 80 snapshots. **Export workspace** downloads session JSON. **Reset workspace** opens a confirmation dialog and clears the current session. Reset is different from a harmless preview. The interface disables conflicting controls while operations are busy.

Mobile controls open and close the topic sidebar and trace inspector. Escape closes mobile panes. Ctrl/Cmd+K focuses search. These controls improve accessibility and navigation; they do not change retrieval algorithms.

### 8.2 Composer and search settings

The question textarea accepts up to 2,000 characters. Enter searches; Shift+Enter enters a new line. Search commits a successful non-clarification turn. The retrieval selector offers Hybrid, BM25, SMART cosine, and semantic search; unavailable semantic execution is indicated. The domain selector chooses all domains or one of four corpus domains.

**Topic constraint** offers Soft boost and Hard lock. Soft boost gives subject terms additional weight across eligible passages. Hard lock restricts to the selected article when there is a confirmed article identity; otherwise it requires all topic terms in passage titles. If fewer than ten eligible passages remain after active filters, it falls back to soft boost and explains why. It is not a guarantee that every result is semantically about the intended subject.

**Diversity** toggles the optional redundancy penalty. **Passage reranking** selects off, fixed depth, or adaptive depth when its local model is available. **Re-score** applies the chosen controls to the selected saved turn as a preview. Changing a selector alone does not commit a new conversation turn.

**Explore meanings**, Term to explore, Find meanings, and its close control launch user-directed sense discovery. Choice cards display source type, excerpt, terms, and passage count. Search all interpretations/Search as written keeps the query broad. Custom focus requires a label and indexed keywords. Cancel clarification abandons the unresolved choice. An offered clarification itself does not add a completed turn.

Starter scenario cards provide suggested searches; View all/Show fewer changes the visible catalog. A scenario strip offers Use next question and Dismiss scenario. These are convenience sequences, distinct from the more extensively checked isolated Demo lab tours.

### 8.3 Saved turns, previews, and evidence cards

The turn selector browses questions within the active topic. A selected old turn can be replayed from its saved pre-turn state. **Preview evidence** retrieves evidence for a saved question whose full result payload is not currently displayed. The browser holds displayed result payloads separately from the server's compact turn records.

**Question only** previews the current question without topic, history, or feedback. **Saved ranking** exits a preview and restores the displayed committed result. There is no “commit preview” button: to add a turn, submit a search. Feedback is a committed annotation even though the refreshed ranking after it is shown as a preview. Do not confuse “conversation turns unchanged” with “no workspace mutation at all.”

Each evidence card shows rank, title, domain, origin badges, seen status, score, and a query-biased snippet. **Read passage/Collapse passage** switches between snippet and full passage. **Wikipedia article** opens the source page. Clicking the score opens its breakdown. Relevant, irrelevant, pin, and clear-feedback buttons modify topic annotations; toggling the relevant/irrelevant/pin control can remove its own mark.

Snippets are extractive: the service selects a sentence with strong effective-term coverage, focuses a roughly 260-character window, and returns matching highlights. They are not generated summaries and are not independently verified answers. Reading the full passage is necessary when the excerpt omits qualifications.

### 8.4 The four execution trace tabs

**State & Decision** shows CREATE/CONTINUE/RESUME/CLARIFY, decision reason, current and previous topic, earlier turns, routing candidates, subject and aspect terms, and requested versus applied scope. Show the actual hard-lock candidate count and fallback reason rather than assuming the selected dropdown was applied unchanged.

**Rewrite & Phrase** shows weighted terms, source roles, source turns for inherited aspects, removable context chips, and quoted-phrase strategy/counts. Removing and restoring a chip makes immutable ranking previews. **Check context impact** replays the saved question with three controlled omissions: topic terms and lock, earlier aspects, or feedback and pins. It reports first-five overlap and rank movement and lets the user preview a variant.

**Postings & Fusion** shows path leaders, candidate/scored counts, channel weights, fused and overlapping candidates, DF/IDF statistics, and reranking depth/time. **Compare methods** replays BM25, cosine, semantic, and Hybrid with matching context and filters while forcing diversity and reranking off. Unavailable methods are reported as unavailable. The first-five overlap with Hybrid describes agreement, not measured relevance.

**Novelty & Profiler** shows new/repeated passages, distinct articles, feedback counts, and stage timings. Raw trace JSON exposes the full response structure. Per-stage times describe processing observed on that run; model initialization, caches, hardware, and order affect them. The bars are diagnostics, not a controlled latency benchmark.

### 8.5 Score inspection and the three different comparisons

Score inspection separates path contributions, term contributions, feedback boost, pin flag, diversity penalty, and cross-encoder metadata. Term contributions usually explain the first stored contributing lexical path, rather than an additive decomposition of every final fusion source. RRF path contributions explain the fusion portion. Final order may additionally depend on pins, reranking, and diversity.

There are three distinct questions:

| Tool | What varies? | What can it establish? |
| --- | --- | --- |
| Compare methods | BM25/cosine/semantic/Hybrid | Ranking and timing differences under fixed context |
| Check context impact | Remove one context source | Sensitivity of results to topic/history/feedback |
| Compare rankings | Midterm versus final engine | Same-question engine differences and rank movement |

None alone establishes better relevance. **Benchmark relevance** adds recorded judgments to an isolated midterm/final replay of a TEST question, including the same earlier raw questions for each engine. It shows nDCG, Precision@10, judgment coverage, changed passage text, and inherited grade labels. TurnTrace 2 reranking can be changed for that replay. Unjudged is a separate status, not grade zero evidence.

**Two subjects** accepts two subjects and an optional focus question, defaults to overview when empty, and retrieves separate evidence columns. It does not synthesize a comparative essay. General ranking comparisons offer customizable midterm controls and a raw midterm trace. The user's saved workspace is preserved by these comparisons.

### 8.6 Experiments and downloads

Experiments shows evaluated turn/conversation counts, judged pairs, behavior checks, metric bars, coverage totals, ablation configurations and intervals, and independent review status. Refresh reloads artifacts; it does not train a model or rerun evaluation. Download controls expose summary JSON, per-turn CSV, unjudged pool, ablation results, and the blind review pool where available.

The API prefers semantic summary artifacts when present, otherwise lexical summaries. Missing evaluation outputs produce an explicit unavailable state. The application does not invent placeholder metrics. Review metrics remain absent while no adjudicated grades exist.

## 9. Demo lab: all eleven actual tours

The authoritative catalog is `data/demo_tours.json`. It contains eleven tours. The catalog totals about 28 minutes, so choose a subset for a short viva.

| Tour | Main live demonstration |
| --- | --- |
| A conversation that remembers | Full JWST question, mirror follow-up, “Tell me more”, source-turn provenance |
| Switch topics. Return without mixing them. | Telescope → CRISPR → original telescope topic ID |
| One word, two meanings | Mercury clarification, element selection, nervous-system follow-up |
| Inspect and challenge the memory | Aspect provenance, term removal/restoration, context audit |
| Teach the search, then undo | Pin, relevant, irrelevant, refreshed preview, reversible annotations |
| Open the IR engine | Quoted phrase, method replay, postings, fusion, profiling |
| Control focus and diversity | Topic scope, hard fallback, domain filter, optional diversity |
| Spend neural effort where it matters | Fixed/adaptive reranking, actual candidate counts and scores |
| Make the improvements visible | Midterm/final replay and two-subject evidence |
| Show measured results honestly | Benchmark relevance, experiments, ablations, coverage limits |
| Explore a word inside any question | Independent term discovery, indexed interpretation, custom focus |

Start guided demo creates an isolated session. Run first step and Run next step execute real operations and check returned state. Pause to inspect passages and trace. View guide returns to the catalog; Resume walkthrough returns to the latest evidence view; Restart tour starts a fresh demo session. Return to workspace or close restores the original workspace, draft, clarification, selected turn, preview, and controls.

During a tour, the guide owns session-changing operations. An interpretation selected directly by the user advances the relevant step once, preventing duplicate submissions. A failed check stops progress; it does not fabricate success. Neural tours require real local model availability. Refresh returns to the normal browser-session workspace because tour progress is not persisted.

Below the tours, the original conversation selector contains all fourteen inherited conversations. Choose one and Start conversation to replay its original questions in order. A clarification pauses for actual user input. Such a replay is a behavior demonstration, not a new relevance judgment or proof that all questions are answered correctly.

### 9.1 A compact live presentation

Begin with a complete telescope question and mirror follow-up. Inspect the subject/aspect distinction. Ask “Tell me more”, point to `mirror` with weight 0.40 and its source turn, remove it, and explain the preview banner. Switch to CRISPR and return to JWST, showing branch reuse. Resolve Mercury to the element. Pin a passage and undo the annotation. Finally show a graded benchmark replay and the Experiments coverage table.

If time permits, compare fixed/adaptive reranking and read the actual evaluated count. Do not promise every adaptive query will score twelve: low agreement chooses thirty-two. Finish the demonstration by explaining one failure or limitation and the next validation experiment. Honest boundaries are stronger evidence of understanding than claiming universal improvement.

## 10. Evaluation: what was measured and what it means

The main run compares raw BM25, the frozen midterm, final lexical hybrid, and final full hybrid on identical chronological TEST turns. Each conversation starts fresh independent state per conversational system. Raw BM25 uses only the current utterance. Evaluation requests twenty results; the interface usually shows ten.

No interactive feedback or interpretation choices are supplied in the inherited automatic benchmark. If clarification occurs, the runner scores immediate results rather than inventing a user's answer. Scripted interaction tests separately assess choices and feedback. This separation avoids presenting hand-scripted behavior success as a retrieval accuracy estimate.

### 10.1 Metric formulas and a worked example

For grade `g_i` at rank `i`, a positive is grade at least one. Unjudged passages receive zero gain in the available-judgment calculation.

```text
P@k = number of positive judgments retrieved in first k / k
DCG@k = Σi=1..k (2^g_i - 1)/log2(i+1)
nDCG@k = DCG@k / idealDCG@k
RR@20 = 1/(first positive rank ≤20), otherwise 0
MRR@20 = mean of RR@20 across eligible turns
Known recall@20 = retrieved known positives / all known positives
Unjudged@10 = unjudged returned top-ten items / actual returned top-ten items
```

Suppose top-three grades are `[2,0,1]`. P@3 is `2/3`. DCG@3 is `3/1 + 0/log2(3) + 1/2 = 3.5`. If the available ideal grades are `[2,1,0]`, ideal DCG is `3 + 1/log2(3)≈3.6309`, so nDCG is about 0.964. RR is 1 because rank one is relevant. If there are four known relevant passages overall and two were found, known recall is 0.5.

If a system returns only three passages and two are positive, P@5 is `2/5`, not `2/3`. If one of those three returned passages is unjudged, Unjudged@10 is `1/3`. A grade-zero passage is judged and irrelevant; an unjudged passage has no recorded assessment. Conflating them hides a major evaluation limitation.

Metrics are macro-averaged over eligible turns. Turns without judgments are omitted for ranking metrics; known recall additionally needs a positive denominator. All forty TEST turns have positive judgments in this artifact. Recall is deliberately called **known** recall because the full universe of relevant passages has not been judged.

For a completely judged binary cutoff, `F1=2PR/(P+R)` combines precision and recall when the denominator is positive. The frozen final evaluator does not report F1, so no F1 result is invented here. Averaging precision and recall first and then applying the formula is not generally the mean of per-turn F1 values. Classification accuracy would require a defined population and reliable negative labels; treating all unjudged corpus passages as verified negatives would be misleading. Retrieval quality therefore uses ranked metrics and coverage, while workflow tests report passed cases separately.

### 10.2 Recorded main results

| System | P@5 | P@10 | nDCG@10 | MRR@20 | Known R@20 | Unjudged@10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Raw BM25 | .8800 | .8525 | .7255 | .9625 | .4993 | 0.00% |
| Frozen midterm | .8950 | .8650 | .6366 | .9375 | .5106 | 0.50% |
| Final lexical hybrid | .8800 | .8125 | .6978 | .9800 | .5340 | 14.75% |
| Final full hybrid | .8700 | .8100 | .6984 | .9633 | .5334 | 16.00% |

Raw BM25 leads nDCG among these four initial rankings; the midterm leads P@10; final lexical hybrid leads MRR and known recall. The semantic addition changes nDCG by approximately +0.0006 relative to lexical hybrid. This is not evidence of a large semantic gain.

The top-ten coverage counts are raw BM25 400/400 judged, midterm 398/400, lexical 341/400, and full hybrid 336/400. The original pool included raw BM25, so equal measured coverage is not guaranteed for new retrieval methods. Unjudged results may be relevant or irrelevant; they must be assessed. Coverage imbalance limits the interpretation of the observed ranking differences but does not justify simply declaring every missing grade relevant.

### 10.3 Ablations and cost

The ten configurations comprise the four main systems, single-topic lexical, no-aspect-history lexical, no-raw-recovery lexical, diversity lexical, full hybrid fixed reranking, and full hybrid adaptive reranking. An ablation removes or alters one component while preserving the rest as far as practical.

| Configuration | nDCG@10 | Mean cross-encoder passages | Paired change against full initial hybrid |
| --- | ---: | ---: | --- |
| Full initial ranking | .6984 | 0.0 | Reference |
| Fixed-depth reranking | .7443 | 32.0 | +.0459, 95% interval [.0145,.0850] |
| Adaptive reranking | .7269 | 18.5 | +.0285, 95% interval [.0036,.0605] |

Adaptive scores `(32−18.5)/32≈42.2%` fewer passages on average than fixed. This is a candidate-cost reduction, not automatically a 42% wall-clock speedup. Initialization, token lengths, batching, and hardware affect time. Fixed achieves the higher measured relevance; adaptive exposes a measured quality/cost compromise.

Removing raw recovery lowers lexical nDCG from .6978 to .6731. The single-topic variant scores .7065 and its paired interval against branching spans zero. Disabling aspect history produces identical rankings on these inherited turns. Diversity gives .5697 nDCG with 29.25% unjudged at ten. These results do not establish that branching, history, or diversity can never help; they show what this particular fixed benchmark supports.

Intervals use paired bootstrap resampling of **eight conversations**, grouping their turns first. Turns in one conversation share history and are not independent observations. A positive interval supports a positive measured difference under this protocol, not universal deployment performance. The small number of conversations and development inspection still constrain inference.

### 10.4 Behavior tests and independent review

Four synthetic behavior cases cover topic return, Mercury choice, feedback/preview/undo, and aspect-history influence. Their passing means the specified inputs caused the expected state and scoring effects. A constructed test that an aspect changes ranking does not prove that carrying it improves relevance for real users.

A separate blind review pool contains twenty new questions in five authored conversations and **742 unique turn–passage pairs** from five systems' top twenty results. Query, history, title, and passage are visible; system and rank are withheld. It currently has **zero adjudicated grades** and no measured independent ranking results.

The next step is two independent reviewers, a shared rubric, agreement analysis, disagreement adjudication, imported validated grades, and rerun metrics. A fresh untouched collection should complement this pool. TEST rankings were inspected during development to diagnose routing errors, so the current TEST comparison is **exploratory**, not a pristine final holdout result.

## 11. Running, reproducing, and troubleshooting

Requirements in the README are Node 22.12 or newer, roughly 1 GB disk and 2 GB RAM; documented checks used Node 24. From the repository root:

```sh
npm ci
npm run verify:data
npm run dev
```

Open `http://127.0.0.1:3100`. If the frozen corpus/index need materializing from an included archive, use `npm run unpack:data`. A GitHub checkout may require obtaining the verified dataset files and placing `corpus.json` and `index.json` under `data/` as described in the README. Do not regenerate different data merely to make a reproduction command succeed.

```sh
npm run prepare:semantic
npm run prepare:reranker
npm run build
npm start
```

Preparation downloads pinned models and prepares the article cache. Production opens on port 3101. `PORT` overrides production API port; changing development backend port also requires checking the Vite proxy.

```sh
npm test
npm run test:browser
npm run eval:v3
npm run eval:v3 -- --semantic
npm run eval:v3 -- --ablation
npm run eval:v3 -- --split=dev
npm run eval:review
```

Default results live under `eval/output/v3/`; semantic, ablation, and review runs have separate subdirectories. `npm run eval` is the historical evaluator, not the final evaluator. `npm run report` renders the research report PDF; Python dependencies are in `requirements-report.txt`. `npm run package:submission` creates the package with the configured four-member default name `CSD358_Shikhar_Antra_Bhupesh_Raghavendra`. An optional `-- --name=YourChosenName` overrides the archive name; the script accepts letters, digits, underscores, and hyphens. The built client, frozen corpus/index, and rendered report must exist first.

Browser tests use Edge on Windows by default and Playwright Chromium elsewhere. The README documents installing Chromium and setting `TURNTRACE_BROWSER_CHANNEL=chromium` if needed. A model-dependent tour being unavailable usually means missing model files or optional Transformers.js, not a failure of lexical search.

### 11.1 Symptom-to-explanation checklist

| Symptom | First explanation/check |
| --- | --- |
| Corpus unavailable | Verify frozen data and index loading; inspect API health |
| Semantic disabled | Check preparation, dependency, cache fingerprint and model status |
| Reranking selects 32 adaptively | Agreement may be below four; inspect trace |
| Hard lock says soft | Fewer than ten eligible candidates survived filters |
| Irrelevant passage disappears | Expected topic-scoped eligibility removal |
| Pinned passage absent | Domain/phrase/hard scope may make it ineligible |
| Saved old turn differs after feedback | Distinguish historical-state replay from current-feedback preview |
| Score order appears unexpected | Inspect pins, reranking and diversity beyond fused score |
| No experiment metrics | Generate artifacts; Refresh only reads them |
| History gone after restart | Sessions are in memory; export is available |
| Tour stops | A live check failed or clarification needs input; inspect rather than skip |

### 11.2 Dated verification evidence

`docs/DEMO_VERIFICATION.md` records local verification on **22 November 2026**, using Node 24 and Microsoft Edge: production build passed; **120 server/unit/API tests and 23 evaluation tests passed, totaling 143**; **18 real browser workflows passed**; all eleven guided tours ran against the real API including local neural models; the fourteen-conversation catalog omitted reference rewrites; a 390×844 mobile layout and diff checks were verified.

These are documented checks, not a statement that this handbook reran them. They cover tested workflows and inputs. They do not certify all possible queries, human relevance, security at production scale, or general topic-routing accuracy.

## 12. Code and API map for a viva

| Location | What to explain there |
| --- | --- |
| `client/src/App.jsx` | View state, sessions, feedback, previews, demo isolation/restoration |
| `client/src/components/SearchWorkspace.jsx` | Composer, evidence cards, clarification and turn views |
| `client/src/components/WorkspaceInspector.jsx` | Final trace tabs, weights, context audit, method replay, scores |
| `client/src/components/ResearchViews.jsx` | Midterm/final, benchmark, subjects and experiment views |
| `client/src/components/DemoLab.jsx` | Tour catalog and walkthrough controls |
| `client/src/demo/demoRunner.js` | Real step execution and returned-response assertions |
| `client/src/workspaceApi.js` | Client API requests and browser session identifier |
| `server/src/v3/workspace.js` | Topic routing, interpretation, aspects, snapshots, feedback, undo |
| `server/src/v3/search.js` | Effective weights, filters, lexical scoring, RRF, reranking policy, diversity, snippets |
| `server/src/v3/semantic.js` | Encoder, article cache, fingerprint, vector feedback and fallback |
| `server/src/v3/reranker.js` | Pinned local cross-encoder download/load/inference |
| `server/src/v3/retrievalArticles.js` | Article grouping, identities, interpretation lookup |
| `server/src/v3/routes.js` | Validation, session queues, preview/audit/compare/evaluation APIs |
| `server/src/api/server.js` | Server, health, index load and API mounting |
| `server/src/api/traceAssembly.js` | Preserved v1/v2 conversational baseline lifecycle |
| `server/src/index/` | Tokenizer, normalizer, Porter stemmer, postings, builder, serializer, champions |
| `server/src/retrieval/` | Inherited BM25/cosine, Boolean/phrase, title filter, fusion, seen penalty |
| `server/src/conversation/` | Inherited context, decisions, extraction, rewriting, decomposition, clarifier |
| `server/src/config/index.js` | Shared paths, baseline parameters and server settings |
| `eval/src/v3.js` | Same-turn final evaluation and ablation runner |
| `eval/src/v3Metrics.js` | Metrics, coverage aggregation and unjudged pool |
| `eval/src/v3Behavior.js` | Separate scripted interaction cases |
| `eval/src/v3Review.js` | Blind new-conversation pool and imported-judgment evaluation |
| `server/test/`, `eval/test/`, `tests/browser/` | Unit/API, evaluator, and real browser workflows |
| `data/demo_tours.json` | Authoritative eleven tours and live expectations |
| `docs/RESEARCH_REPORT.md`, `docs/EVALUATION.md` | Measured claims, protocol, limitations and reproduction |

The final active inspector is `WorkspaceInspector.jsx`. Older UI components such as `TraceInspector.jsx`, ChatPanel, and old modals remain in the repository; their presence does not imply they are all mounted in the final workspace.

Important `/api/v3/` endpoints are GET/DELETE `session`, POST `search`, `preview`, `topic`, `feedback`, `undo`, `methods`, `context-audit`, and `compare`; GET `comparison-benchmarks`, `scenarios`, `demos`, `evaluation`, and `export`; plus allowed evaluation downloads. Search validates inputs and returns ten results through the public workspace routes. The underlying search service permits a configurable topK from 1 to 100.

Preview-only features reject invalid mutation use: historical turn IDs, question-only mode, and context variants are constrained to preview execution. Session IDs allow a bounded set of letters, digits, underscores, and hyphens. This is useful defensive validation, not an authentication or multi-user authorization system.

## 13. Limitations, failure analysis, and future work

**Rule coverage:** title/acronym/lexical rules can confuse incidental mentions with a new subject or miss an unusual alias. The final guard was developed partly after a Library of Alexandria follow-up was incorrectly diverted to Museum of Work. The corrected case is useful evidence of diagnosis, but it also explains the exploratory TEST caveat.

**Collection coverage:** four domains and curated benchmark topics restrict generality. A new subject may have no article or only sparse mentions. Custom focus helps express intent but cannot create missing evidence.

**Semantic granularity:** one vector per article compresses long texts. Passage details are supplied mainly through lexical evidence. Future passage embeddings would increase storage/preparation and require another fair evaluation; they are not already implemented.

**Candidate recall:** the cross-encoder reorders a bounded pool. A relevant passage absent from that pool cannot be recovered by reranking. Adaptive agreement is a budget heuristic, and agreement can be jointly wrong. Quantization and truncation also create quality/cost trade-offs.

**Feedback drift:** a mistakenly relevant passage can inject misleading expansion terms or article-vector direction. Topic scope, visible weights, preview, clear feedback, and undo make correction possible, but they do not prevent every bad adjustment.

**Diversity trade-off:** reducing redundancy may push direct answers down. Measured diversity results are weaker on this pool and have more unjudged hits. It is an optional exploration setting, not a universally improved ranking policy.

**Evaluation validity:** small data, AI-derived grades, incomplete pooling, TEST inspection, and no completed independent adjudication prevent broad relevance claims. Behavior tests establish specified functions, not user satisfaction. A new held-out conversational collection, independent assessors, measured agreement, and a user study would address different gaps.

**Operations:** in-memory sessions, limited session count, local CPU inference, lazy model initialization, and no account database are reasonable project choices with scaling limits. The current code is not evidence of distributed production readiness. Better persistence, concurrent-load measurement, controlled warm/cold latency experiments, and stronger deployment controls would be future engineering work.

## 14. Likely viva questions and model answers

1. **What is your project in one sentence?** An inspectable conversational passage search workspace with resumable topics, user correction, weighted hybrid retrieval, and optional local neural reranking.

2. **What problem does it solve?** Short follow-ups lose their subject, while blindly carrying all history mixes topics; we preserve separate subjects and expose the context used for ranking.

3. **Is it a chatbot or search engine?** A search workspace: it returns ranked corpus passages and trace evidence, rather than generating a free-form answer.

4. **What did you inherit?** The frozen corpus/index, benchmark, classical retrieval modules, and midterm conversational engine, preserved as a baseline.

5. **What is new in the final project?** Branching topics, persistent meanings, effective numeric weights, local semantic integration, feedback, immutable previews, audits, richer comparison, and adaptive reranking integration.

6. **Did you invent BM25 or RRF?** No. They are established methods; we implemented and integrated them with attribution.

7. **What is an inverted index?** A term-to-postings mapping that lets us score documents containing query terms without scanning every document body.

8. **Why remove stop words?** They often add little discrimination in lexical ranking; raw text remains available for conversation rules and exact phrase handling.

9. **Why stemming?** To match morphological variants such as plural and singular forms. It does not solve all synonymy or ambiguity.

10. **TF versus DF?** TF counts occurrences within one passage; DF counts passages containing the term. IDF downweights collection-common terms.

11. **Why BM25?** It balances rare-term importance, repeated-term saturation, and document-length normalization using interpretable components.

12. **What are k1 and b?** Here k1=1.2 controls TF saturation and b=.75 controls length normalization strength.

13. **Why cosine as another path?** A normalized term-vector channel can rank differently from BM25; fusion uses complementary rankings.

14. **What does lnc.ltc mean?** Document log TF/no IDF/cosine normalization; query log TF/IDF/cosine normalization, with the final weighted implementation using explicit source weights.

15. **Why rank fusion instead of adding raw scores?** Raw score scales differ. RRF combines rank evidence without requiring calibrated BM25 and neural score magnitudes.

16. **What is your final RRF constant?** Twenty. The preserved inherited fusion uses sixty, so the two must be distinguished.

17. **Does a fused score mean confidence?** No. It is a ranking signal assembled from paths and adjustments, not a probability or truth certificate.

18. **Why raw recovery?** A small current-query-only channel reduces dependence on potentially mistaken inherited context, within active filters.

19. **What is the subject/aspect difference?** JWST is a persistent subject; orbit or mirror is a changing aspect of the current information need.

20. **How do you resume a topic?** Match the explicit subject/acronym to an existing branch or select the branch manually, then reuse its identity and feedback.

21. **Is routing learned?** No. It uses title, alias, acronym, overlap, pronoun, and query-pattern rules.

22. **What if routing is wrong?** Select the correct topic, start a new topic, choose a meaning, or inspect/remove inherited terms using a preview.

23. **When do you ask clarification?** For supported competing bare senses and some ambiguous backward references; the user can also request term exploration.

24. **Where do Mercury options come from?** Indexed article identities and their passage evidence, rather than generated unsupported descriptions.

25. **Why Explore meanings separately?** It lets the user disambiguate one term inside a longer question that automatic bare-subject rules may not clarify.

26. **What is a custom focus?** A user-provided label and indexed keywords used as an explicit topic, not an automatically proven dictionary sense.

27. **What are your source weights?** Current 1.00, subject .85, selected earlier aspects .40, and up to eight feedback expansion terms .35.

28. **Do repeated sources add?** Current, entity, and feedback contributions add; history is added only when the term is not already represented.

29. **Does every follow-up inherit all aspects?** No. Recognized brief elaboration requests inherit up to four from the latest substantive same-topic turn.

30. **Did you train the semantic model?** No. We run a pinned pretrained quantized MiniLM locally and prepare corpus article vectors.

31. **How many embeddings do you store?** 728 article-group embeddings of 384 dimensions, not one vector for every passage.

32. **How do article vectors rank passages?** Article affinity is projected to allowed passages with lexical and section-position bonuses.

33. **Bi-encoder versus cross-encoder?** Separate embeddings support reusable retrieval vectors; joint query–passage scoring is slower but can refine a small candidate set.

34. **What is the reranker model?** Pinned pretrained Xenova MS MARCO MiniLM L-6-v2, locally executed with quantized weights.

35. **How does adaptive depth work exactly?** At least four overlaps among the lexical and semantic top-eight passage IDs chooses up to twelve candidates; otherwise up to thirty-two.

36. **Is adaptive depth always faster?** It reduces candidates on high-agreement turns; wall-clock gains depend on initialization, batching, and input lengths.

37. **Can reranking retrieve a missed document?** No. It reorders an existing candidate prefix, so first-stage recall bounds its opportunity.

38. **What happens without local models?** Availability and reason are exposed, neural-dependent tours are unavailable, and search can use explicit lexical fallback.

39. **What does relevance feedback do?** It adds topic-scoped exemplar terms and candidate boosts, plus semantic article direction when available; it does not train model weights.

40. **Pin versus relevant?** Pin prioritizes an eligible passage explicitly; relevant provides evidence signals and a limited boost without guaranteeing first place.

41. **Can a pin override the domain filter?** No. Pins are filtered by active eligibility and topic scope.

42. **Why MMR-style diversity?** To reduce repeated content by trading some relevance for lower similarity to selected evidence.

43. **Is diversity on by default?** No, and the primary ranking benchmark keeps it off.

44. **Soft boost versus hard lock?** Soft adds subject weights; hard restricts to a confirmed article or titles containing all subject terms, relaxing below ten eligible passages.

45. **Preview versus search?** Search commits a successful turn; preview computes on a detached state and preserves saved conversation turns.

46. **Does feedback mutate state?** Yes. The annotation is committed and undoable; its immediate ranking refresh can still be a preview.

47. **How do historical previews work?** The workspace retains pre-turn snapshots and saved options, allowing replay of that turn without adding another one.

48. **What does a context audit prove?** That removing a context source changes or preserves the ranking; relevance improvement needs judgments or user evidence.

49. **What does Compare methods vary?** The retrieval model under the same context and filters, with diversity and reranking disabled.

50. **Why a separate benchmark relevance mode?** Arbitrary queries lack recorded grades. Benchmark replay attaches available qrels and coverage to comparable evidence.

51. **What is the dataset size?** 35,000 passages, 728 article groups, fourteen dialogues, seventy turns, with forty TEST turns in eight dialogues.

52. **Are the qrels human validated?** No. They are inherited AI-derived assessments and should not be presented as expert ground truth.

53. **What is nDCG?** Discounted graded gain normalized by the ideal ranking of available judgments, emphasizing highly relevant passages near the top.

54. **Why MRR as well as precision?** MRR emphasizes the first relevant hit; precision measures how much of a cutoff is relevant. They answer different questions.

55. **Why known recall?** Only a subset of relevant passages is judged, so the denominator is known positives rather than all truly relevant passages.

56. **Unjudged versus irrelevant?** Unjudged means no label exists. Metrics assign zero gain for calculation, but that does not prove irrelevance.

57. **Did the final system beat every baseline?** No. Initial raw BM25 leads measured nDCG; fixed reranking leads the reported reranking comparison, subject to the evaluation limits.

58. **What did semantics improve?** Only about .0006 nDCG over lexical hybrid in the recorded main run; there is no demonstrated large semantic gain here.

59. **What is the adaptive cost result?** Mean 18.5 versus 32 candidates, about 42% fewer, with .7269 versus .7443 nDCG for adaptive and fixed.

60. **Why bootstrap conversations?** Turns share context, so conversations are the resampling unit to respect that dependence.

61. **Is TEST untouched?** No. Rankings were inspected while debugging routing, making the reported comparison exploratory.

62. **What does the independent pool establish now?** It prepares 742 blinded pairs for review; zero adjudicated grades means no independent relevance result yet.

63. **Do demo passes prove accuracy?** They prove specified interactions on tested inputs, separately from ranking relevance or general user benefit.

64. **How many guided tours exist?** Eleven actual tours, plus the fourteen original conversations in a separate selector.

65. **Is the system offline?** Runtime retrieval and neural inference use local corpus/model files after preparation; preparation itself downloads models, and source links can open the web.

66. **What are your strongest limitations?** Rule-based routing, article-level semantic granularity, bounded candidate recall, small incomplete AI-derived evaluation, and in-memory sessions.

67. **What would you validate next?** Independently judge the blind pool, measure agreement, evaluate a fresh held-out conversational set, and conduct a user study for correction workflows.

68. **What tests can you honestly quote?** The 22 November verification document records 143 unit/API/evaluation tests and eighteen browser workflows passing; these are dated documented checks.

69. **Why preserve the original engine?** It provides a traceable baseline, enables direct replay, and separates inherited methods from the final contribution.

70. **What is your defensible conclusion?** The project implements a working inspectable correction workflow and reports promising reranking trade-offs, while relevance and generalization claims remain provisional.

## 15. Terminology and phrases to avoid

| Term | Plain meaning in this project |
| --- | --- |
| Corpus | Frozen searchable passage collection |
| Posting | One term's occurrence record for a passage |
| Entity/subject | Persistent topic identity |
| Aspect | Current property or subquestion |
| Anaphora | A backward reference such as “it” |
| Ellipsis | Omitted context such as “Tell me more” |
| Provenance | Where a term, label, or result signal came from |
| Candidate | Passage considered before final selection |
| Hybrid | Combination of retrieval channels |
| RRF | Rank-based list fusion |
| MMR-style selection | Greedy relevance/redundancy trade-off |
| Embedding | Numeric vector representing input text |
| Quantization | Lower-precision model representation for resource savings |
| Logit | Raw model output used for ordering |
| Qrels | Query-specific relevance judgments |
| Pooling | Combining system outputs to choose items for assessment |
| Ablation | Controlled removal/change of a component |
| Adjudication | Resolving assessor disagreements into final grades |
| Macro average | Mean of per-turn metric values |
| Preview | Noncommitting retrieval calculation on copied state |
| Exploratory result | Finding interpreted with development/test limitations |

Do not say “we invented BM25/RRF/MMR.” Say “we integrated established methods into our workflow.” Do not say “we trained MiniLM.” Say “we used pinned pretrained models with local inference.” Do not say “all passages have dense vectors.” Say “728 article vectors guide passage candidates.” Do not say “the final system is best on every metric.” Quote the actual winners and limits.

Do not call AI-derived qrels human ground truth, an unjudged passage irrelevant, or the independent review pool completed evaluation. Do not call a logit confidence, a rank change a relevance gain, a synthetic scenario real-world accuracy, or a context audit a causal user-benefit study. Do not call adaptive depth twelve unconditionally. Do not claim a 42% latency improvement from candidate counts alone.

Do not say the final workspace automatically applies the inherited seen penalty or exposes arbitrary Boolean syntax. Do not describe exports as persistent accounts, snippets as generated answers, Wikipedia links as live corpus refresh, or a selected Hard lock control as proof hard restriction was actually applied. Read the trace.

## 16. Last-minute cheat sheet

**Identity:** inspectable conversational passage retrieval; inherited midterm plus final resumable/correctable workspace. **Collection:** 35,000 passages, four domains, 728 articles. **Benchmark:** 14 dialogues/70 turns; DEV 6/30; TEST 8/40; 1,283 TEST judged pairs; AI-derived and not human validated.

**State:** session → topics → turns; CREATE/CONTINUE/RESUME/CLARIFY. Feedback is topic-scoped. Previews clone state; search commits; undo restores snapshots; memory expires after six inactive hours and restart clears it.

**Weights:** current 1; topic .85; up to four earlier aspects .40 for brief elaboration; up to eight feedback terms .35. **BM25:** k1 1.2, b .75, final TF 1.2×title+body. **Fusion:** final k20; weights 1/.65/.75/.20 for BM25/cosine/semantic/raw recovery. Inherited RRF k60.

**Neural:** pretrained local quantized MiniLM; 384 dimensions; article title plus leading text; corpus fingerprint; explicit fallback. Cross-encoder fixed ≤32; adaptive top-eight overlap ≥4 → ≤12, else ≤32. Pins precede reranked regular candidates. Diversity .6 relevance − .4 redundancy, off by default.

**Results:** raw .7255, midterm .6366, lexical .6978, full .6984 nDCG@10. Fixed .7443; adaptive .7269, 18.5 mean candidates versus 32. Unjudged lexical 14.75%, full 16%. Four synthetic behavior cases pass in recorded artifacts. New blind pool 742 pairs, zero adjudicated grades. TEST inspected: exploratory.

**Demo:** telescope mirror → more/provenance → CRISPR → JWST return → Mercury element → feedback/undo → benchmark coverage. Eleven tours; fourteen original dialogues. **Commands:** `npm ci`, `npm run verify:data`, `npm run dev`; prepare both models for neural demos; `npm test`, `npm run build`, `npm run test:browser`; `npm run eval:v3 -- --ablation` for the ten-system experiment.

When unsure, identify the layer: state routing, query construction, eligibility, candidate retrieval, fusion, reranking, diversity, display, or evaluation. Explain its input, rule, output, and limitation. That structure lets you reason from the actual implementation instead of memorizing unsupported claims.
