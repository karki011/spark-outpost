# Universal laws

Five guardrails Spark applies around every Builder, approved October 1, 2026 (policy `laws-1-universal-laws`). Each one is a small rule in `apps/server/src/laws/`, every threshold is a named constant in `advisor/policy.ts` (`LAW_*`), and agents read everything through the `spark_laws` tool. Decisions are stored as `run_advice` rows with purpose `law` (migration 0089): one `estimate`, one `budget` and one `findings` record per run.

| Law                | What Spark does                                                                                        | Where it shows                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Chesterton's fence | Flags code the Builder removed without being asked and without saying why                              | Keep card ("Worth a look before you keep this"), the final reply |
| Goodhart's law     | Trusts its own check run over the Builder's claim; flags weakened tests, config and out-of-scope edits | Keep card, the final reply                                       |
| Hofstadter's law   | Estimates time and cost from the user's own runs, padded by how long tasks really took                 | Plan cards (Build this plan?)                                    |
| Parkinson's law    | Gives each Builder a tool-call and time budget scaled to the task's complexity; stops and asks past it | Builder head, route why line, budget card                        |
| Peter principle    | Stops routing a task kind to a model whose recent pass rate fell below its tier peers                  | Builder route note and why line                                  |

## 1. Chesterton's fence: no unexplained deletions

`laws/removals.ts` reads the Builder's diff (`changesSoFar`) and finds deleted files, removed functions, classes and exports (TypeScript, JavaScript, Python, Go, Rust), removed test cases, removed guards (auth, permission, token, CSRF, rate-limit, validation and assertion calls) and blocks of 30 or more net removed lines (`LAW_REMOVED_BLOCK_LINES`). A name that reappears anywhere in the added lines counts as moved, not removed; so does a deleted file whose name is added elsewhere.

A removal is explained when a sentence in the request names it with a removal word ("delete src/legacy.ts"), the request asks for broad cleanup ("remove dead code", "unused exports"), or a sentence in a Builder reply names it with a removal word ("Removed helperTotals because nothing calls it"). Everything else becomes one line: "Removed `X` from `path` — why?".

When the Critic runs, it decides: its prompt gets the rule, the Builder's reply and the removals Spark found, and it answers with `[removed]` findings, which never make the verdict concerns and never start a fix round. When no Critic runs (or it fails), the rule's list is used.

## 2. Goodhart's law: checks run outside the agent

Spark already ran the project's checks itself after every Builder turn (`orchestration/checks.ts`): the keep card, the Tasks panel and the reply report Spark's run, never the agent's words. `laws/claims.ts` now compares the two: when a Builder reply claims the tests, lint, typecheck or build pass and Spark's run of that turn failed, the finding names the failing command ("Bolt said the checks pass, but Spark's own run failed: `pnpm test` exited 1."). A claim Spark could not confirm (checks skipped because `package.json` scripts changed during the run) is flagged too.

`laws/goodhart.ts` adds, unless the request asks for it:

- **Weakened tests:** a test file that gains `skip`, `only`, `todo`, `xit` or `@pytest.mark.skip`, loses assertions, or swaps strict matchers (`toBe`, `toEqual`, `toHaveBeenCalledWith`) for loose ones (`toBeTruthy`, `toBeDefined`, `toHaveBeenCalled`).
- **Updated snapshots** (`__snapshots__/`, `.snap`).
- **Config edits:** lint, typecheck, CI, test-runner and check config files, and changed `test`, `lint`, `typecheck`, `check` or `build` scripts in `package.json`.
- **Untouched files:** when the request, the agreed plan or the Builder's plan names files, a changed file that none of them (nor a Builder reply) names and that is not next to a named file. Lockfiles are exempt; at most 5 (`LAW_SCOPE_ITEMS`).

Findings are computed once at wrap-up, stored, shown on the keep card (up to 8, `LAW_ITEMS_SHOWN`) and appended to the reply. They don't block keeping: the user (or the autonomy level) still decides.

## 3. Hofstadter's law: learned estimates

Every Do run records its estimate (`laws/estimate-history.ts`) under a key: the task kind (Jev's intent category, or `other`), the size (the complexity signal the route score uses, Jev's rating or the rules') and the chat model. Actual duration is the run's active time (`orchestrations.active_ms`, waits excluded) and actual cost is the run's and its children's `cost_usd`; both already existed.

- With 5 or more succeeded Builder runs of the same kind and size (`LAW_ESTIMATE_MIN_RUNS`), on the same model or else on any model, the estimate is the median of the last 20 with a 20th–80th percentile range: "Usually ~6 min, ~$0.40 for a task like this (5–7 min, $0.38–$0.46 over 7 similar runs)".
- Otherwise a rule estimate labelled rough: 3, 6, 12, 20 or 35 minutes by complexity (`LAW_ROUGH_MINUTES`) and the route score's trajectory cost for the chat model × 1.5, with a ×0.5–×2 range.
- **Padding:** each record keeps its unpadded estimate, so the median ratio of actual to estimated over the last 20 runs (at least 5) becomes a factor between 1 and 3 (`LAW_PAD_MAX`) applied to the next estimate, separately for time and cost; the text says "padded ×1.4".

The estimate shows on the Build this plan? card (plan first and risky work) before anything is built.

## 4. Parkinson's law: budgets scale with complexity

When the first Builder of a run starts, it gets its own budget: a share of the run's tool-call and active-time budget by complexity, 30%, 50%, 75%, 100%, 100% for levels 1–5 (`LAW_BUDGET_SHARE`), at least 10 tool calls and 3 minutes and never more than the run's. On Claude (60 tool calls, 15 minutes) a trivial edit gets "budget 18 tool calls · 4.5 min"; Codex counts commands as tool calls and gets twice as many. The budget shows in the Builder's head, in the route why line ("budget 18 tool calls · 4.5 min for complexity 1 (Jev)") and in `spark_run`.

The budget covers the Builder's turn and its check-fix turns. Past it, Spark stops the Builder and shows the budget card ("Bolt used its 18 tool calls · 4.5 min budget for complexity 1 work and was stopped so the change doesn't sprawl"); Continue lifts the Builder budget for the rest of the run, Stop stops. The card never auto-continues. The run budget, the per-task spend cap and the Critic fix-round budget are unchanged and still apply; a Critic or a fix round ends the Builder budget's window.

## 5. Peter principle: demote models whose pass rate drops

`laws/demotion-history.ts` reads this workspace's Builder outcomes: every top-level run with a settled outcome (`task_outcomes.verdict` good, bad or mixed; good is a pass), its kind and each Builder model that worked on it. Per model and kind it keeps the last 20 (`LAW_DEMOTE_WINDOW`) and needs at least 10 (`LAW_DEMOTE_MIN_RUNS`). A model is demoted for a kind when its pass rate is more than 15 points (`LAW_DEMOTE_MARGIN`) below the pooled rate of its tier peers (same card tier, other models with 10+ runs of that kind), or below 60% (`LAW_DEMOTE_FLOOR`) when no peer has enough runs.

On Auto, the route score caps a demoted model's expected quality at its measured pass rate, so its expected cost includes that failure risk and the score moves the work to another model. The route note says why: "Sonnet 5 has passed 55% of recent bug fixes here (11/20; its mid tier peers 90%), so Spark routed this work elsewhere". A pinned model (or Spark off) is never overridden; the note ends "pinned, so Spark kept it". Recovery is automatic: the window slides, and once the rate is back over the bar the note and the cap disappear.

## Spark tool

`spark_laws` (private): the run's estimate, budget and findings (defaults to this chat's latest run), the estimate history grouped by kind, size and model, the current demotions and the thresholds. `spark_run` also shows each Builder's budget, and the demotion in its route note.

## Not built yet

- Coordinator pieces share the run's budget; a per-piece budget scaled by each piece's demand rating, and demotions in piece routing (`kindPassRates` reads benchmark rates, not this workspace's outcomes), are open.
- A budget overrun asks; it does not escalate to a stronger model on its own.
- Estimates are not yet shown before a build that skips the plan card, and pieces have no per-piece estimate.
- The thresholds are first guesses. Before tightening them, compare stop-and-ask rates and pass rates per complexity level on the dev history.
