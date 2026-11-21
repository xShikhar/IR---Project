# Reproducing the TurnTrace 2 evaluation

From the repository root, install the dependencies and verify the materialized corpus and index.

```sh
npm ci
npm run unpack:data
npm run eval:v3
```

The default run uses the inherited TEST split. For the DEV split or all inherited conversations, pass `--split=dev` or `--split=all`. These runs write to their own subdirectories under `eval/output/v3/`. The original benchmark remains available through `npm run eval`.

To add a fourth system using the full hybrid with the local semantic channel, run `npm run prepare:semantic` and then `npm run eval:v3 -- --semantic`. Its artifacts go under `eval/output/v3/semantic/`. This run requires the prepared local model and article vectors.

## Protocol

- All three systems receive the same raw utterances in the same order and request 20 results. Raw BM25 has no session. The frozen midterm v2 baseline and TurnTrace 2 each receive a fresh session at the start of every conversation.
- Both TurnTrace 2 configurations use the default best-match order with diversity off. The lexical configuration also disables the semantic channel for reproducibility. The fixed dialogues provide no pin, relevance feedback, or clarification choice, so the benchmark scores the immediate ranked results even when the system offers a clarification.
- The runner reads the frozen `data/qrels.json` directly and uses it to score the completed rankings. The ranking systems receive the raw query and their own accumulated runtime state.
- The TEST split has 8 conversations, 40 turns, and 1,283 judged turn–passage pairs. All 40 turns have at least one positive judgment. The set of judged passages is incomplete for each information need.

## Metrics

| Field | Meaning |
| --- | --- |
| `p5`, `p10` | Count of observed relevant results at the cutoff divided by the cutoff. The positive threshold is grade ≥ 1. |
| `ndcg10` | Discounted gain at rank 10, normalized by the ideal order of the available judgments. Gains use `2^grade − 1`. |
| `mrr20` | Mean reciprocal rank of the first observed relevant result within the top 20. |
| `knownRecall20` | Proportion of the available grade 1 or 2 passages returned in the top 20. |
| `unjudged10` | Fraction of actual top-ten results without a judgment, averaged over turns with at least one result. Grade 0 counts as judged. |

Metrics are macro averages over turns. Ranking metrics omit turns with no judgments. Known-judgment recall additionally omits turns with zero positive grades. Unjudged ranking hits receive zero gain in the measured ranking metrics, and the coverage counts include those hits. The `retrievedAt10`, `judgedAt10`, and `unjudgedAt10` totals also allow a micro coverage calculation over returned passages.

## Outputs

| File in `eval/output/v3/` | Contents |
| --- | --- |
| `summary.json` | Split and label provenance, aggregate metrics, coverage counts, and synthetic case results. |
| `per_turn.csv` | Same-turn system records, ranked passage IDs, metrics, and clarification indicators. |
| `unjudged_pool.csv` | Unique unjudged turn–passage pairs from the union of the evaluated systems' top-ten rankings. |

## Interpreting new evidence

The midterm describes the inherited grades as LLM-judged. Its archived judging script implements deterministic rules for the course rubric. No independent human validation is available. The new pool provides the topic, transcript, title, and passage for review, with blank grade and notes columns. It omits system and rank to blind reviewers to retrieval provenance. The inherited reference rewrites are available in `data/conversations.json` for a separate assessor-only lookup by query ID. Have reviewers apply the [judging rubric](judging_rubric.md) independently before adjudicating disagreements and reporting agreement.

The scripted telescope return, Mercury choice, and feedback/undo checks are purpose-built behavior assertions. They run in isolated sessions and have their own pass counts in `summary.json`. The runner writes the artifacts before returning a failing exit status if a synthetic check fails.

TEST rankings were inspected during development to diagnose false topic switches. The comparison is exploratory. Independent evidence would require a fresh held-out set and new relevance judgments.
