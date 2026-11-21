# Demo lab: presentation guide

Start the app with `npm run dev`, open http://127.0.0.1:3100, and choose **Demo lab**. Prepare the semantic and reranker models first if their tour cards report unavailable prerequisites.

## Using the walkthroughs

Select a feature card to read its questions, actions and presenter notes. **Start guided demo** creates a separate session. The guide stays visible while the real Search, Compare and Experiments views display the results. **Run first step** and **Run next step** execute actual API operations; completed checks report observable behavior from the returned data.

Pause between steps to read passages, inspect scores, or open the execution trace. The guide runs conversation and feedback mutations itself; the regular composer and session-changing sidebar controls are reserved until the tour ends. An offered interpretation can also be selected directly: the guide advances that choice once instead of submitting it twice.

**View guide** returns to the catalog without losing progress. **Resume walkthrough** returns to its last evidence view. **Restart tour** starts an empty demonstration session. **Return to workspace**, or the guide's close button, restores your original session, unsent draft, clarification, selected turn, preview and retrieval controls. Refreshing the page returns to the regular browser-session workspace; tour progress is not persisted across refreshes.

## Tour coverage

| Tour | What to show |
|---|---|
| A conversation that remembers | Complete question, pronoun follow-up, elliptical request, aspect provenance |
| Switch topics. Return without mixing them. | Independent JWST/CRISPR memories and automatic return to the original topic |
| One word, two meanings | Corpus-backed Mercury interpretations and persistence of the selected meaning |
| Explore a word inside any question | Separate explored term, indexed sense selection and user-defined focus keywords |
| Inspect and challenge the memory | Earlier-aspect provenance, context-impact audit and immutable removal/restoration previews |
| Teach the search, then undo | Pinning, relevance feedback, exclusion and undo within one topic |
| Open the IR engine | Positional phrase matching, BM25/cosine/semantic/hybrid comparison, postings, fusion and profiling |
| Spend neural effort where it matters | Fixed and adaptive local cross-encoder candidate depths and per-passage scores |
| Retrieval controls | Soft preferences, hard lock/fallback, domain filters and optional MMR diversity |
| Make the improvements visible | Midterm/final replay with the same earlier context and separate two-subject evidence |
| Show measured results honestly | Graded benchmark replay, coverage, ablations, measured metrics and validation limits |

The full set contains roughly 28 minutes of optional presentation material. You do not have to run every tour. For a short demonstration, prioritize topic return, Mercury, feedback/undo, reranking and the evaluation discussion. For a technical viva, add phrase matching, query weights, history provenance and context-impact auditing.

## Original benchmark conversations

The selector below the tour cards contains the fourteen inherited conversations, including the telescope mission, topic shifts and ambiguous terminology. Choose one and press **Start conversation**. The original questions are preserved; reference rewrites and expected labels are not sent to this catalog.

Run the questions in order. If the engine asks for clarification, choose an interpretation from the live results before continuing. The guide pauses rather than silently guessing. These replays demonstrate behavior; they do not automatically establish correctness or compute a new relevance judgment.

## What the checks mean

- A topic check verifies the active topic and branch count, not human coreference accuracy in general.
- A preview check compares the actual returned session; feedback steps preserve committed turns while changing annotations.
- A model check requires actual availability and, for reranking, a positive scored-candidate count.
- A comparison shows the same question/context supplied to both engines. Rank movement alone is not a relevance improvement.
- The experiments use inherited AI-derived judgments with incomplete coverage for new results. TEST was inspected during development; the results are exploratory. Synthetic demo checks are reported separately from retrieval relevance.

If a check fails, the guide stops advancing. Inspect the response and error, then restart the tour after resolving the issue. It never fills in a successful result or fabricated metric.
