# TurnTrace 2 demo

From the repository root, install dependencies, verify the frozen data, and start the workspace.

```sh
npm ci
npm run unpack:data
npm run dev
```

Open the client URL printed by the dev command. Run `npm run eval:v3` to regenerate the Experiments data.

## Resume a topic

1. Search for `James Webb Space Telescope`. Open a returned passage and inspect the ranked evidence.
2. Ask `What about its mirror?`. Check the active telescope topic and the source of carried query terms in the trace.
3. Search for `CRISPR gene editing`. Both topics should now appear in the workspace.
4. Ask `Back to the James Webb Space Telescope. What instruments does it use?`. The original telescope topic should become active. Select either existing topic in the sidebar to resume it manually.

## Resolve an ambiguous query

1. Start with a fresh session and search for `Mercury`.
2. Choose **Mercury (element)** from the clarification choices. Inspect the ranking and the active interpretation.
3. Change the retrieval model and use **Re-score** to see how passage order and scoring evidence change. Open **Compare** to inspect changes against the midterm baseline.

## Apply feedback and inspect experiments

1. Search for `James Webb Space Telescope` in a fresh session.
2. Pin a passage from lower in the list, then ask `What about its mirror?`. The pinned passage should lead the follow-up.
3. Change a ranking control and use **Re-score** to preview the selected turn. Check that the conversation has the same number of committed turns.
4. Undo the follow-up and the pin. Try marking a passage relevant or irrelevant and rerunning a follow-up in the same topic.
5. Open **Experiments**. Compare the three systems on TEST and review unjudged coverage alongside nDCG. Download **Per-turn results** and **Unjudged pool** from the same view.
