# Demo lab verification

Verified locally on 22 November 2026 with Node 24 and Microsoft Edge.

| Check | Result |
|---|---|
| React production build | Passed |
| Server/unit/API tests | 120 passed, 0 failed |
| Evaluation tests | 23 passed, 0 failed |
| Real browser workflows | 18 passed, 0 failed |
| All eleven guided tours against the real API | Passed, including both local neural models |
| Original conversation catalog | Fourteen conversations; no reference rewrites exposed |
| Mobile layout | Verified at 390 x 844 |
| Whitespace/diff checks | Passed |

The browser suite covers existing search and ranking features alongside new tour startup, progress, restart, session restoration, draft and clarification preservation, manual interpretation selection without duplicate turns, context-audit output, comparison views, original conversations, and correct experiment-view resumption. A regression check prevents redundant session requests from replacing freshly completed steps with stale state.

The runner tests also reject false success when a comparison returns a changed session or a retrieval method is unavailable. Model-dependent tours expose prerequisites rather than reporting fallback as successful neural execution.

Commands: `npm test`, `npm run build`, `npm run test:browser`, `git diff --check`.

Scope: these checks verify implemented workflows and tested inputs. They do not certify every possible query, establish relevance beyond the recorded judgments, or replace independent human evaluation.
