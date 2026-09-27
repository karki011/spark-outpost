# Analytics and harness optimizer plan

Proposed on September 26, 2026. The goal is an Analytics page that shows where time, money and quality go, and an "Optimize workflow" button that tunes this user's harness from what actually worked for them. Both rest on one thing the harness did not have before: an outcome-quality signal per task. [HARNESS_PLAN.md](HARNESS_PLAN.md) describes the harness itself, and [JEV.md](JEV.md) describes Jev.

## Ground rules

- **Local only.** Outcomes, feedback, comments and every aggregate stay in this workspace's Postgres. Nothing is sent anywhere. The only model calls are the ones "Ask about this view" and anomaly explanations make, and those go to the user's own default provider with a snapshot the user can inspect.
- **Optimizer proposals change only this user's local harness settings.** They never change code, never open a git pull request, and are never shared with other users or sent to any service. A proposal is a new version of a local settings record, nothing more.
- **Never loosen safety.** No proposal can widen the allowlist, lower the involvement level, skip an approval, raise a budget, or enable Full access. Those stay user-only settings.
- **Keep evidence distinct.** Implicit signals, explicit feedback, and model opinions are stored and shown separately, as in the harness plan's "Evidence, kept distinct".
- **Deterministic first.** Detection, scoring and estimates are pure functions over recorded data. A model only explains or answers questions about numbers the harness already computed.

## Phases

| Phase                                     | Status                  | What lands                                                                                        |
| ----------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| 1. Signals                                | **Done** (September 26) | `task_outcomes`, `outcome_signals`, implicit signals, thumbs feedback, the outcome and report API |
| 2. Aggregation                            | Next                    | Daily rollups, counterfactual joins (rules vs Jev pick), per-profile-version slices               |
| 3. Overview, Spend and Harness tabs       | Planned                 | The first Analytics screens on the phase 2 rollups                                                |
| 4. Sessions                               | Planned                 | Flight recorder and friction metrics                                                              |
| 5. Anomalies and Ask                      | Planned                 | Deterministic anomaly detection, "Ask about this view"                                            |
| 6. Profile, recommendations and optimizer | Planned                 | Versioned harness profile per project, recommendations, the "Optimize workflow" button            |

## Phase 1: outcome signals (done)

One outcome row per top-level turn (`task_outcomes`, keyed by the orchestration run, with the task when there is one), and one row per signal (`outcome_signals`, keyed by run and kind). Migration `0032_task_outcomes.sql`.

### Signals

Each signal is stored once with its time, its source and a small detail object. Signals are derived from facts the harness already records (keep card answers, `runs.reverted_at`, check artifacts, run status, the next turns), so re-deriving is idempotent.

| Signal          | Weight | Source                     | When                                                                                   |
| --------------- | -----: | -------------------------- | -------------------------------------------------------------------------------------- |
| `kept`          |     +1 | `user`                     | Keep on the keep card                                                                  |
| `checks_passed` |     +1 | `harness`                  | The last check round of every Builder passed                                           |
| `quiet_24h`     |   +0.5 | `timer`                    | 24 hours passed with no correction, re-ask or revert                                   |
| `committed`     |     +2 | `git`                      | Every kept file, with the kept content, appears in one later commit on the kept branch |
| `reverted`      |     −2 | `user`                     | Revert on the keep card, or "Revert to before this run" later                          |
| `correction`    |   −1.5 | `jev`, `heuristic`, `user` | The next turn reads as a correction, or "Ask for a fix" on the keep card               |
| `re_ask`        |     −1 | `heuristic`                | A turn in the next 24 hours, in any chat, repeats the request (word overlap ≥ 0.6)     |
| `checks_failed` |     −1 | `harness`                  | A Builder's last check round failed                                                    |
| `cancelled`     |     −1 | `harness`                  | The run was stopped                                                                    |
| `failed`        |   −1.5 | `harness`                  | The run failed or ended `outcome_unknown`                                              |

- **Corrections.** Only the next turn in the same chat within 24 hours is classified, and only once its intake is recorded, so Jev's answer is available when Jev is connected. Jev is used where possible: a follow-up Jev files as `bug_fix` or `debugging` right after a turn that changed files is a correction with source `jev`. Otherwise a short phrase list ("that's wrong", "fix it", "didn't work", "still failing", "not what I asked") decides, with source `heuristic`. The detail records Jev's category, whether the phrases matched, the follow-up run and the gap in minutes.
- **Commit detection.** When a Do turn ends with changes in a git repo, the harness records the kept result: the branch and the blob hash of each changed file (`git hash-object` without `-w`, so nothing is written). A sweep in the API process, every 10 minutes, checks kept results younger than 14 days in repos the user linked. It lists commits on that branch since the kept time and compares their trees with `git rev-list` and `git ls-tree`. Every git command it runs is read-only; a test asserts refs, `HEAD` and the working tree are unchanged.
- **Pull requests later.** The schema reserves the source `pr` and the kinds `pr_merged`, `pr_closed`, `pr_reverted` and `pr_review_comments` (weight 0 until measured). Nothing produces them yet; they will come from the PR links tasks already capture.
- **Score.** `score = Σ weight / Σ |weight|` over the signals and explicit feedback (±3), in [−1, 1], stored with its reasons. The verdict is the rating when there is one; otherwise `good` or `bad` when every signal agrees, `mixed` when they conflict, and `unclear` with none.

### Thumbs feedback

- **Where.** After Keep, "How did it go?" with Good result and Bad result under the keep card's result. After Revert, "What went wrong?" with Wrong approach, Broke something, Too much change and Other, and an optional comment. Under the final answer of a direct question or explain turn, a quiet thumbs row. Bad result also offers the reasons, and every rating can take an optional comment.
- **When it nudges.** Only on a finished turn that succeeded, and at most once per task. It shows when the implicit signals are mixed or unclear (fewer than two agreeing signals), and on a random 20% of the rest for calibration (`OUTCOME_SAMPLE_RATE`, 0 in browser tests). The decision is made once and stored with its reason, `mixed` (mixed or unclear) or `sampled`.
- **Always available.** Every finished turn that isn't nudged shows a small Feedback button in the same place, which opens the same row. A rating, the reasons and the comment can be changed at any time, including after a pull request exists.
- **Never** during a run, and never as a popup or dialog.
- **Accessibility.** Labelled buttons with `aria-pressed`, a group label, a `status` line that says Saved, keyboard reachable in reading order, a shape cue on selected items (a filled thumb, a tick on reasons) as well as colour, only theme tokens that `pnpm a11y:contrast` covers, and no motion.

### API

- `GET /api/runs/:id/outcome` refreshes and returns the turn's outcome, or `null` while it runs.
- `PUT /api/runs/:id/feedback` `{ rating, reasons?, comment? }` records or changes feedback; `409` until the run has finished.
- `GET /api/analytics/outcomes?groupBy=day|project|provider|model|category|jev_decision|jev_vs_rules&days=30` returns counts per group: turns, verdicts, mean score, ratings, nudges and samples, keeps, reverts, commits and corrections. It joins `run_advice`, so `jev_decision` (what the gate would apply) and `jev_vs_rules` (same pick, different pick, no Jev) can be set against outcomes.

## Analytics tabs

| Tab          | Shows                                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Overview** | Outcome score trend, good/bad/mixed split, keep and revert rates, cost per good outcome, the three largest changes this week                                                                                                                     |
| **Spend**    | Cost by provider, model, role and category (reported vs estimated kept apart), Jev's own cost, cost per kept change, what routing saved against the pinned model                                                                                 |
| **Harness**  | The routing flow (intake → depth → roles → models → outcome), Jev confidence against outcome with the gate lines drawn (fallback 0.5, clarify 0.5 / 0.6 / 0.75 by level, act 0.75 read-only and 0.9), and rule pick vs Jev pick against outcomes |
| **Sessions** | A flight recorder per turn (intake, checkpoints, agents, checks, keep, follow-ups on one timeline) and friction metrics: approval wait, checkpoints per turn, retries, corrections, time to Keep, check rounds                                   |
| **Insights** | Anomalies, recommendations, and the Optimize workflow entry point                                                                                                                                                                                |

## Ask about this view

- One text box on every tab. It uses the default provider's cheapest model (Haiku for Claude, the fast tier for Codex and Z.ai), in chat mode with no tools.
- The context is a structured snapshot of the view, not the database: the tab, the filters, the rows and totals on screen, and the definitions of each metric and signal. The user can open "What was sent" before and after asking.
- Comments and request text are included only when the view shows them, inside an `untrusted` block that the prompt treats as data, never as instructions.
- The answer is labelled as an AI answer with its cost, and it can cite only numbers in the snapshot.

## Anomaly detection

- Deterministic detectors over the phase 2 rollups: a spend spike (daily cost above a 14-day median plus 3 MAD), a revert or correction rate jump per model or category, a new check failure streak, Jev's confidence drifting from its measured accuracy near a gate, a provider's failure or timeout rate rising, and routing that stops saving money.
- Each anomaly carries its evidence (the series, the baseline, the threshold). The AI is asked only to explain an anomaly in plain words from that evidence, and can be skipped.

## Recommendations

- Generated deterministically from the counterfactuals the harness records: `run_advice` holds both the rules' and Jev's pick for every run, `model_stats` holds measured pass rates and costs, and outcomes now say which runs went well.
- Each recommendation names the setting, the proposed value, the evidence (turns affected, outcome difference, cost difference, sample size) and a confidence. Below a minimum sample (for example 20 comparable turns) it is shown as "not enough data" rather than proposed.

## The "Optimize workflow" button

- **Harness profile.** A versioned, per-project record of the tunable harness settings that today are constants or chat settings: the Jev gate lines, depth rules, when to use an Architect and a Critic, the parallel thresholds, lean build, check commands and when checks run, the default models per role, and the command allowlist (which the optimizer can only read or narrow). Version 1 is today's behaviour.
- **Proposals.** The button computes proposals against the current profile version, each estimated from the recorded counterfactuals: "raising the act line to 0.92 would have sent 14 turns to the rules; those turns had a 0.4 lower mean score with Jev's pick".
- **Review.** The user sees each change as a before/after diff with its evidence, and accepts all, some or none. Nothing applies without that.
- **Apply and measure.** Accepting creates a new profile version. Analytics then compares turns before and after that version on the same categories and projects, and shows the difference once each side has enough turns.
- **Rollback.** One click restores any earlier version as a new version; history is never rewritten.
- **Audit.** Every proposal, acceptance, rejection, apply and rollback is an entry in the audit log with the old and new values and the evidence shown.
- **Safety.** Proposals never loosen safety settings (allowlist, involvement level, approvals, budgets, Full access, secret-file rules). A proposal that would is dropped before it is shown.
- **Scope.** Proposals change only this user's local harness settings: no code changes, no git pull requests, nothing shared with other users.

## Data given to the optimizer

- Outcomes, signals and aggregates are numbers the harness computed.
- Feedback comments are user text. Wherever a model sees them (Ask, anomaly explanations, the optimizer's summaries), they are passed as untrusted data inside a delimited block, capped in length, and never as instructions. Request text is treated the same way.

## Open questions

- How long to keep outcomes and comments; the audit log keeps 90 days by default.
- Whether a turn's outcome should roll up into its task's outcome once a task spans several turns, or stay per turn with a task view on top.
- The minimum sample size per recommendation, once phase 2 shows real volumes.
