# TurnTrace 2

An inspectable conversational search workspace with resumable topics, actionable disambiguation, weighted hybrid retrieval, local semantic search, topic-scoped feedback, evidence snippets, diversity, and immutable comparison.

Built on [the TurnTrace midterm](https://github.com/xShikhar/IR---MidTerm-Assignment), commit `d0022603ebd9181f21e0e406cfd4a2d72af79104`. Original algorithms and benchmark artifacts are preserved. See [the original README](docs/MIDTERM_README.md).

## Run

Requires Node **22.12+** (tested on 24), about 1 GB disk and 2 GB RAM. The submission includes the frozen corpus/index and prepared semantic cache.

For a GitHub checkout, obtain `corpus.json` and `index.json` from the [course dataset folder](https://drive.google.com/drive/folders/1v6gZbclgtuP-jE0E5L60N5V7Aucx-5RY?usp=drive_link) or a verified midterm checkout and place both files in `data/`. Run `npm run prepare:semantic` after installing dependencies to enable local semantic search.

```sh
npm ci
npm run verify:data
npm run dev
```

Open **http://127.0.0.1:3100**. The API runs on **3101**, keeping the final project separate from the midterm's 3000/3001.

Production mode serves the React build and API from one process:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3101** in production. `PORT` overrides the production port; update the Vite proxy separately if changing the development backend port.

## Substantial changes

| Midterm | Final project |
|---|---|
| One active entity/aspect state | Persistent topic branches with automatic resumption and manual selection |
| Shared ambiguous stems | Corpus-backed interpretation choices persisted in topic memory |
| Appended query string | Explicit term weights consumed by the new scorers |
| Separate lexical rankers | Weighted ensemble plus local semantic channel, fused by RRF |
| Hard title lock | Soft subject preference and raw-query recovery candidates |
| Seen-document penalty | Optional relevance/diversity balancing and topic-scoped feedback |
| Read-only trace | Term removal, score inspection, previews and reversible correction |
| Re-score changes state | Snapshot previews and midterm/final comparison |
| Passage lists | Focused snippets and two-subject evidence comparison |

Original `/api/chat` and midterm modules remain intact; new behavior lives in `server/src/v3/` and `/api/v3/`.

## Demo

1. Ask **What is the James Webb Space Telescope?** Then **Where is its orbit?**
2. Ask **Explain CRISPR gene editing.** Two topic branches appear.
3. Ask **Back to JWST, what instruments does it carry?** The telescope branch resumes.
4. Start a topic and ask **Mercury**. Choose **Mercury (element)**, then follow up.
5. Mark evidence relevant, reject a result, or pin a passage. Re-score and undo.
6. Ask about Webb's mirror, then ask **Tell me more.** In **Query terms**, inspect the inherited mirror term and its source turn. Remove and restore it to preview the ranking with and without that context.
7. Use **Compare / Two subjects** for separate JWST and Hubble evidence.
8. Open **Experiments** for measured metrics and judgment coverage.

Detailed walkthrough: [docs/DEMO.md](docs/DEMO.md).

## Local neural search

```sh
npm run prepare:semantic
```

The CPU model is a pinned quantized `Xenova/all-MiniLM-L6-v2`, run through Transformers.js. Each article group has a 384-dimensional embedding based on its title and leading passages. Semantic article evidence is combined with passage-level lexical scoring. This is **article-level semantic retrieval**, not an embedding of every passage or a trained conversational model.

Preparation downloads the model once to `data/raw/semantic/`; runtime uses local files only. Missing dependencies/cache are reported with an explicit lexical fallback. Corpus fingerprints reject mismatched vectors. The prepared cache is included in the submission.

## Evaluation

```sh
npm test
npm run eval:v3
npm run eval:v3 -- --semantic
```

The default v3 evaluation compares raw BM25, the frozen midterm and the new lexical ensemble on identical TEST turns. The semantic run adds the neural hybrid and writes separate results. Outputs include nDCG@10, Precision@k, MRR@20, recall against known judgments, unjudged@10, per-turn CSVs and a blind review pool. Synthetic behavior checks are separate from relevance metrics.

**Limits:** inherited data has 14 dialogues / 70 turns (40 TEST). Relevance judgments are AI-derived and have no independent human validation. New systems retrieve unjudged passages, so ranking results on this pool are provisional. Rule-based routing and synthetic behavior cases do not establish general real-world accuracy. Runtime never reads reference rewrites. Old `eval/output/test_final/` files remain historical artifacts.

See [evaluation protocol](docs/EVALUATION.md) and [research paper source](docs/RESEARCH_REPORT.md).

## Verification and submission

```sh
npm run build
npm run test:browser
npm run report
npm run package:submission
```

Browser checks use installed Microsoft Edge by default on Windows and Playwright Chromium elsewhere. To use Chromium on Windows, run `npx playwright install chromium --only-shell` and set `TURNTRACE_BROWSER_CHANNEL=chromium` before running the checks. PDF generation requires Python. Install its dependencies with `python -m pip install -r requirements-report.txt`. The ZIP includes source, corpus/index, semantic cache, built client, experiments and report. Set the submission name with:

```sh
npm run package:submission -- --name=CSD358_Member1_Member2_Member3
```

Review the member names before uploading. The report links to the final project repository. Sessions are isolated in server memory, expire after six hours of inactivity, and can be exported; server restarts clear history.

## Source layout

- `client/`: React workspace and production assets.
- `server/src/v3/`: search service, topic memory and API.
- `server/src/index/`, `retrieval/`, `conversation/`: original midterm engine.
- `data/`: frozen corpus, index, judgments, semantic cache and scenarios.
- `eval/src/v3*`, `eval/output/v3/`: final evaluation and review pools.
- `tests/`: browser workflows.
- `docs/`: design, demo and research methodology.
- `output/pdf/`, `output/submission/`: report and submission ZIP.

## Attribution

The inherited Wikipedia corpus retains CC BY-SA/GFDL attribution and source provenance. The model retains upstream metadata and license. BM25, cosine, RRF, MMR and feedback methods are established algorithms. Our contribution is the integrated resumable, correctable retrieval workflow and its measured behavior. AI assistance in code, tests and documentation, inherited judgments, and new synthetic cases are disclosed separately from human validation.
