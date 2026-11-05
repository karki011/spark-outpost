# Live end-to-end harness run · 2026-09-26 (round 5)

The first test of the whole product path with real agents: the web UI driven by Playwright, the real API and worker processes, real `claude-agent-acp`, `codex-acp` and Z.ai (GLM) agents, and Jev. It compares the harness at checkpoint `d4c59d3` with direct Claude and direct Codex, with two older checkpoints, and with its own settings and models. Data: [harness-e2e-live-2026-09-26.json](harness-e2e-live-2026-09-26.json). Runner: `scripts/e2e-live` (`pnpm e2e:live`).

- **Spend:** $19.55 API-equivalent of the $40 cap, over 188 cells (190 runs including 2 discarded). Both CLIs are on subscription logins, so the only real money was Jev ($0.018 for 364 calls). Codex costs are estimated from tokens.
- **Pass rate:** 176 of 188 cells passed their hidden checks.
- **Wall time:** about 5 h 20 min, sequential.

## Headline

1. **Quality is a tie at this difficulty.** Over the same 18 scenarios twice (36 runs per arm), the harness passed 33, direct Claude 32 and direct Codex 33. Leave out the ambiguous request that nobody handled well (n), and the scores are 33/34, 32/34 and 33/34. The harness won one scenario outright (g, the project check the Builder did not know about: 2/2 against direct Claude's 0/2) and lost one run to a harness bug (d #1, where a plan was only one-sixth built and still reported done).
2. **The harness costs about 2.2× direct Claude and takes 2.4× the wall time.**
   - Totals: $4.85 and 30 min for the harness, $2.18 and 13 min for Claude, $2.26 and 22 min for Codex.
   - All of the extra comes from planned work. Planned scenarios cost 2.1× to 4.4× direct: c, d, f, l, q, r and t. Execute-depth scenarios cost 0.65× to 1.3×.
   - Round 3 measured 1.39× cost and 0.93× time. This round also includes Balanced approvals (4.9 per UI run), checks after every Builder and more planning (q and l now get an Architect).
3. **The six dry-run bugs are fixed.** One new UI finding showed up (turn-2 cards hidden, below), and no crash or hang happened in 188 live runs apart from one Postgres connection limit hit by a concurrent test run.
4. **The most valuable harness features were, in order:**
   1. project checks with a resumed fix turn (g);
   2. per-lane placement (parallel P1 in 57–60 s with no dependency waits);
   3. clean Stop (s, 2/2 clean);
   4. the Critic, whose findings were real but changed no pass or fail.
5. **The least valuable, or harmful:**
   - M6 resume stopped firing across chat turns in d4c59d3. The new card-driven routing changes the model between turns, so every turn 2 starts fresh; the older versions resumed at a third of the cost.
   - The review-intent Critic still depends on a 0.41–0.54 coin flip.
   - Clarify never fired on an ambiguous request.
   - Codex usage is under-counted inside the harness.

## Method

- **Harness.** A git worktree at `d4c59d3` under the scratchpad, with its own install, its own PostgreSQL schema on `TEST_DATABASE_URL` and its own ports (API 4339, web 5194).
  - The real `src/api/main.ts`, `src/workflow/main.ts` and Vite ran, with the keychain Jev and Z.ai keys and the Claude and Codex CLI logins.
  - Playwright opened a new chat, linked the scratch repo from the repo menu, picked Auto, Do and Balanced (or the cell's level or model) in the model panel, typed the request, and answered every card like a Balanced user:
    - edits and routine commands: "Allow for this run";
    - push, sudo, curl or `rm -rf` outside the repo: Deny;
    - plan: Approve; Keep; retry: Retry; clarify: Jev's first choice; budget: Stop; merge conflict: Reconcile;
    - cards with a countdown were left to continue on their own (the default 10 s).
  - Old checkpoints (2381803, 9a932f9) ran from their own worktrees, databases and ports, driven through the HTTP API with the same answers, so that UI differences don't affect the comparison.
  - A few harness cells use the in-process bench runner at Full auto: forced shared or worktree lanes, and the t lanes.
- **Direct Claude.** The `scripts/bench` direct arm: one Claude agent (Sonnet 5, medium) in Do mode at Full auto, with no orchestrator and no Jev. This is the same baseline as rounds 1–4.
- **Direct Codex.** `codex exec` with gpt-6-sol at medium (low and high in the models block), in a workspace-write sandbox. Cost is estimated from the token counts at the app's price table.
- **Scratch repos and checks.** A fresh git repo per cell under `scratchpad/e2e-live/live/repos`. Hidden checks are copied in only for verification, and they fail before the run and pass with a correct solution. The rules match earlier rounds: the visible suite green, the hidden checks green, and nothing changed outside the allowed files. Special checks:
  - a (question): reply patterns;
  - n (ambiguous): asked before building;
  - s (Stop): cleanup of run status, worktrees, sessions, agent processes and approvals.
- **Repeats.** n=2 for the core and new-scenario blocks, n=1 for versions, configs, models and GLM. Treat single-run differences, and cost or time ratios within about 1.3×, as noise.
- **During the run.**
  - Two fixture fixes: the rename check wrongly failed a barrel file re-exporting the deprecated alias, a test covering the alias, and a README line naming it. The q cells were rescored from their saved repos.
  - One runner fix: direct Claude replies are read from the run events.
  - Three cells were discarded and rerun: two direct Claude replies that weren't captured, and one cell killed by Postgres "too many clients" while another agent's DB tests ran.

## Harness vs direct

Pass · mean cost · mean wall, n=2. Diff is mean lines added and removed. j and s are harness-only.

| Scenario | Harness | Direct Claude | Direct Codex | Harness ÷ Claude cost | Harness diff | Claude diff | Codex diff |
| --- | --- | --- | --- | --- | --- | --- | --- |
| a · Simple question | 2/2 · $0.028 · 12 s | 2/2 · $0.021 · 7 s | 2/2 · $0.015 · 9 s | 1.33× | +0 −0 | +0 −0 | +0 −0 |
| b · Single-file fix (T2) | 2/2 · $0.029 · 22 s | 2/2 · $0.045 · 14 s | 2/2 · $0.034 · 17 s | 0.65× | +1 −1 | +1 −1 | +1 −1 |
| c · Vague multi-module fix (H1) | 2/2 · $0.361 · 100 s | 2/2 · $0.115 · 43 s | 2/2 · $0.098 · 69 s | 3.14× | +42 −7 | +12 −4 | +58 −10 |
| d · Two independent features (P1) | 1/2 · $0.216 · 68 s | 2/2 · $0.103 · 31 s | 2/2 · $0.063 · 43 s | 2.10× | +68 −0 | +126 −0 | +100 −0 |
| e · Review request (R1) | 2/2 · $0.108 · 51 s | 2/2 · $0.085 · 40 s | 2/2 · $0.089 · 57 s | 1.27× | +30 −1 | +30 −2 | +34 −2 |
| f · Destructive clean-up (D2) | 2/2 · $0.263 · 91 s | 2/2 · $0.085 · 28 s | 2/2 · $0.066 · 40 s | 3.09× | +92 −12 | +76 −12 | +72 −12 |
| g · Check the Builder does not know about | 2/2 · $0.115 · 35 s | **0/2** · $0.035 · 12 s | 2/2 · $0.054 · 29 s | 3.25× | +25 −2 | +23 −1 | +24 −2 |
| h · Over-build-prone cache (L2) | 2/2 · $0.059 · 38 s | 2/2 · $0.063 · 23 s | 2/2 · $0.051 · 34 s | 0.93× | +62 −3 | +66 −3 | +66 −4 |
| i · Two turns in one chat | 2/2 · $0.083 · 47 s | 2/2 · $0.070 · 25 s | 2/2 · $0.107 · 42 s | 1.18× | +26 −1 | +27 −1 | +24 −1 |
| j · Build and review (H4) | 2/2 · $0.349 · 248 s | – | – | – | +107 −1 | – | – |
| k · Python project | 2/2 · $0.056 · 25 s | 2/2 · $0.046 · 16 s | 2/2 · $0.048 · 30 s | 1.23× | +42 −1 | +28 −1 | +24 −1 |
| l · Type errors across files | 2/2 · $0.174 · 59 s | 2/2 · $0.040 · 12 s | 2/2 · $0.055 · 24 s | 4.38× | +6 −6 | +6 −6 | +6 −6 |
| m · Accessible UI toggle | 2/2 · $0.037 · 22 s | 2/2 · $0.036 · 12 s | 1/2 · $0.045 · 27 s | 1.04× | +10 −1 | +10 −1 | +9 −1 |
| n · Ambiguous request | 0/2 · $0.234 · 61 s | 0/2 · $0.058 · 20 s | 0/2 · $0.075 · 43 s | 4.00× | +54 −2 | +18 −2 | +44 −2 |
| o · Security-sensitive upload rule | 2/2 · $0.045 · 31 s | 2/2 · $0.047 · 16 s | 2/2 · $0.041 · 27 s | 0.97× | +14 −3 | +15 −3 | +24 −6 |
| p · Docs only | 2/2 · $0.041 · 21 s | 2/2 · $0.035 · 13 s | 2/2 · $0.031 · 18 s | 1.17× | +12 −0 | +12 −0 | +12 −0 |
| q · Rename across 13 files | 2/2 · $0.207 · 78 s | 2/2 · $0.051 · 17 s | 2/2 · $0.059 · 39 s | 4.05× | +30 −22 | +27 −22 | +31 −23 |
| r · Turn 2 changes the plan | 2/2 · $0.210 · 103 s | 2/2 · $0.085 · 31 s | 2/2 · $0.136 · 53 s | 2.47× | +63 −0 | +59 −0 | +62 −0 |
| s · Stop mid-run (cleanup) | 2/2 · $0.084 · 54 s | – | – | – | +16 −0 | – | – |
| t · Lanes meeting in one file | 2/2 · $0.161 · 48 s | 2/2 · $0.070 · 23 s | 2/2 · $0.066 · 46 s | 2.29× | +117 −0 | +108 −0 | +104 −2 |

**Diff size.** Diffs are the same size across arms, within a few lines everywhere, except c (the harness writes 42 lines to Claude's 12; Codex writes 58) and n (the harness builds more on an ambiguous request).

**Failures:**
- **d #1:** the harness chose one Builder for a six-step plan. The Builder did step 1 only ("Step 1 done."), and the rules answered "done · next finish", so the run succeeded with half a feature.
- **g:** direct Claude missed the project's `lint` (API-surface) check both times. The harness caught it with its checks and resumed the same Builder for a fix ("Continued session").
- **m, Codex #2:** its toggle lacked a state attribute (`aria-pressed`).
- **n:** every arm built without asking.

## Against earlier rounds

Mean harness cost and wall, with direct Claude in brackets. Rounds 1–4 ran at Full auto with no UI or approvals.

| Task | Round 1 | Tuned (2) | Round 3 | Round 4 / Lean round | This round (Balanced, UI) |
| --- | --- | --- | --- | --- | --- |
| T2 (b) | $0.059 · 22 s ($0.057) | $0.059 · 18 s ($0.059) | – | – | $0.029 · 22 s ($0.045) |
| H1 (c) | – | $0.354 · 90 s ($0.157) | $0.332 · 94 s ($0.169) | $0.354 · 79 s | $0.361 · 100 s ($0.115) |
| P1 (d) | – | – | $0.282 · 94 s ($0.179) | $0.376 · 89 s; shared $0.390 · 85 s, worktree $0.317 · 229 s | $0.216 · 68 s ($0.103); shared $0.272 · 60 s, worktree $0.252 · 57 s |
| R1 (e) | – | – | $0.127 · 57 s ($0.148) | $0.113–0.14 · 56–139 s | $0.108 · 51 s ($0.085) |
| D2 (f) | – | – | $0.329 · 110 s ($0.106) | – | $0.263 · 91 s ($0.085) |
| L2 (h), off / lean | – | – | – | $0.099 · 40 s / $0.108 · 31 s | $0.059 · 38 s / $0.046 · 26 s |
| Pass (harness) | 15/15 | 15/16 | 10/10 | 5/5 + 16/16 | 33/36 |

- **Harness trend.** Its cost on the same tasks is flat or lower: T2 is half, thanks to a Haiku Builder; D2 is −20%; P1 is −23% to −35%; L2 is −40% to −57%. P1 lanes are no longer slow: 57–60 s against 229 s for worktrees in the Lean round.
- **Direct Claude got cheaper too.** H1 fell from $0.157–0.169 to $0.115, so the harness ÷ direct ratio on H1 rose from 2.0× to 3.1×.

## Harness versions

The same scenarios through the HTTP API at Balanced (n=1). Current is the core UI run (n=2).

| Scenario | 2381803 (M6, round 3) | 9a932f9 (M4, Critic alongside, chains) | d4c59d3 (current) |
| --- | --- | --- | --- |
| a | 1/1 · $0.019 · 13 s | 1/1 · $0.019 · 11 s | 2/2 · $0.028 · 12 s |
| b | 1/1 · $0.039 · 17 s | 1/1 · $0.040 · 17 s | 2/2 · $0.029 · 22 s |
| c | 1/1 · $0.285 · 79 s | 1/1 · $0.287 · 80 s | 2/2 · $0.361 · 100 s |
| d | 1/1 · $0.221 · 65 s | 1/1 · $0.232 · 62 s | 1/2 · $0.216 · 68 s |
| e | 1/1 · $0.061 · 37 s | 1/1 · $0.060 · 33 s | 2/2 · $0.108 · 51 s |
| f | 1/1 · $0.419 · 166 s | 1/1 · $0.248 · 97 s | 2/2 · $0.263 · 91 s |
| g | 1/1 · $0.051 · 22 s | 1/1 · $0.052 · 21 s | 2/2 · $0.115 · 35 s |
| h | 1/1 · $0.065 · 37 s | 1/1 · $0.062 · 35 s | 2/2 · $0.059 · 38 s |
| i | 1/1 · $0.048 · 25 s | 1/1 · $0.048 · 24 s | 2/2 · $0.083 · 47 s |
| Sum | 9/9 · $1.21 | 9/9 · $1.05 | 17/18 · $1.26 |

- **Every version passes.** The old checkpoints passed all 18 runs, so the tasks don't separate versions on quality.
- **The current version is 4–20% dearer overall, for three reasons:**
  - checks with a fix turn on g ($0.115 against $0.05; older versions have no checks, and their Builders happened to update `api-surface.json` on their own);
  - more Architect time on c;
  - lost resume on i: the older versions resumed turn 2 ("Continued session", $0.015, 10–11 s), while d4c59d3 started fresh ($0.045–0.050, 17–29 s);
  - one expensive e run ($0.162 with 8 tool calls, against $0.053 for the other; noise).
- **It is cheaper on f** (the destructive plan) than 2381803: $0.263 against $0.419, because 2381803 retried with an Opus Builder.
- **Parallel P1 works on both old versions.** 2381803 split steps 1 and 2 against its rules, and 9a932f9 ran its chains. The current version, left to Jev, kept one Builder both times and lost a run to it (below).

## Jev's decisions: where they helped and hurt

**Helped:**
- **a (question):** depth `direct` with one Scout (Jev at 1.0) cost $0.028, against Codex's $0.015.
- **b and o (small fixes):** Haiku or Sonnet at execute depth made the harness cheaper than direct Claude on b (0.65×).
- **L4 array on f:** with rules only, the destructive task fell to one Sonnet Builder for $0.05–0.08 and still passed. That is 3–5× cheaper than Jev's Opus Architect plus Critic ($0.26), which suggests the destructive route is over-provisioned when the plan is spelled out in the request.

**Hurt:**
- **d #1 (one Builder, half a plan).** Jev was unsure about one Builder (0.55); the rule kept one Builder; the Builder did step 1; then the transition rule answered "done · next finish" at 0.60. A step-completion check against the plan was missing. The run should have continued with the other steps, or the plan tracker should have failed the run.
- **Resume (i), a regression since 9a932f9.** Jev picked Haiku at low effort for turn 1 and Sonnet at high for turn 2 of the same small feature. The settings hash changed, so turn 2 opened "Fresh session (settings changed)" both times. It cost $0.045–0.050, against $0.015 when the older versions resumed.
- **Review intent (e).** Jev's intent confidence was 0.44, 0.49, 0.41 and 0.47 on the four Auto R1 runs, below the 0.5 threshold, so no Critic ran. Only the two pinned runs (Sonnet and Opus, 0.54) got a Critic. The configs "Claude Critic" cell on e therefore never ran a Critic.
- **Ambiguous request (n).** Jev read "Make the reports better." as docs at 0.68 and 0.72 with `plan_execute`. Balanced asks only below 0.6, so no clarify card appeared, and the Architect invented a scope (+54 lines).
- **Planned depth on mechanical work.** l (type-error rename) and q (13-file rename) went `plan_execute` because of the multi-file risk. Each cost about 4× direct, and direct passed both in 12–17 s.

**Architect route.** The Opus Architect ran on c, f and n (rules: unsure or destructive). Jev's picks never passed the gate.

## Lanes: shared tree vs worktrees

| Run | Pass | Wall | Cost | Builders (s) | node_modules prep | Waited |
| --- | --- | --- | --- | --- | --- | --- |
| d, lanes by Jev (#1, #2) | 1/2 | 64 s, 72 s | $0.227, $0.206 | one Builder (15 s, 30 s) | – | – |
| d, forced shared (#1, #2) | 2/2 | 56 s, 64 s | $0.277, $0.267 | 16.6+16.4, 25.9+18.7 | none needed | – |
| d, forced worktree (#1, #2) | 2/2 | 55 s, 59 s | $0.250, $0.254 | 15.8+19.0, 22.8+20.2 | offline install 210/213 ms, 359/351 ms | 0 ms |
| d, Lean (Jev) | 1/1 | 71 s | $0.246 | 29.5+22.4 | shared tree (Jev sure) | – |
| t, forced worktree (#1, #2) | 2/2 | 71 s, 26 s | $0.256, $0.065 | 23.0+18.9 then join 9.1; #2 one Builder | skipped (no lockfile) | 0 ms |

- **Speed.** Worktrees and the shared tree are the same speed now (57 s against 60 s). The worktree cost of the Lean round (229 s) is gone.
- **Dependency prep.** pnpm offline installs in the copies took 0.2–0.36 s, and no check or command ever waited for them.
- **Parallel lanes are the reliable way to finish P1.** Both forced placements passed 2/2 at about $0.26. Left to Jev, the harness kept one Builder at about $0.21 and failed one of two runs. Parallel is cheaper than a missed step.
- **No merge conflict happened.** On t, the two lanes both edited the README module list, and git merged them cleanly (#1). On #2 the Architect planned one Builder. The merge-conflict card was not exercised live.

## Critic value

The Critic ran on f, on j, and on the two pinned-model e runs: 14 reviews in all. Seven raised concerns; six of those were real defects that the hidden checks did not test, and one was noise.

**Findings that mattered:**
- **j #1** (Codex gpt-6-sol): the credit-clamping edge case in `lineTotalsCents`. This led to a fix Builder (Opus, $0.21), and the hidden checks passed either way.
- **f, 2381803 and Hands-on** (gpt-6-sol): distinct `±Infinity` entries collapse to one duplicate key, and non-finite cents are kept as null. These are real data-integrity bugs in the clean-up, which the hidden checks did not test.
- **e, pinned Sonnet and Opus** (gpt-6-sol): `(1e-2)` is accepted, and the rounding of `-1.125` and `(0.025)` changed. These are real R1 compatibility regressions that the hidden checks did not test. No fix turn followed (a review at execute depth only reports).

**Noise:**
- a missing trailing newline (f #2, gpt-6-luna);
- "the plan called for running tests" when the checks had run;
- the Claude (Opus) Critic's 6–10 point walkthroughs saying "looks good".

**Cost.** A Codex Critic costs $0.001–0.03 as recorded, but that figure is under-counted (see bugs). A Claude Opus Critic costs $0.11–0.13 and adds about 25–50 s. The Codex Critic took 25–153 s wall, the longest single member on j.

**Verdict.** The Critic found real defects in 6 of 14 reviews but changed no pass or fail. Its value is in catching untested regressions, so keep it for destructive work and explicit review requests, and make the review request deterministic.

## Resume savings

- **Resume works on the older versions and broke in d4c59d3.** At 2381803 and 9a932f9, turn 2 of i resumed the Builder's session ("Continued session") for $0.015 and 10–11 s. At d4c59d3, turn 2 always starts fresh for $0.045–0.050 and 17–29 s, 3× the cost. The cause is model-card routing: Jev now picks Haiku at low effort for turn 1 and Sonnet at high for turn 2, so the settings hash changes. Start fresh and "resumed" cost the same on d4c59d3, because both were fresh.
- **Direct Claude's bench arm doesn't resume.** It doesn't record the reply the resume check needs ("chat changed since"), so it is not a fair resume baseline.
- **Codex `exec resume` costs more.** Turn 2 re-read the thread: 160k input tokens against 82k, and $0.07 against $0.036.
- **Resume inside a run does work.** On g the check fix turn resumed the Builder ("Continued session") and cost $0.108 for 12 s of work, against $0.070 and 23 s for the first round.

## Lean on and off

- **h (L2 cache):** Lean passed 2/2 with the hidden safety checks green. It wrote +30 −1 lines (source +14) against +62 −3 (source +19) with Lean off, and cost $0.046 against $0.059 (−22%) in 26 s against 38 s. It left one `lean:` shortcut per run.
- **c:** Lean cost $0.252 against $0.361 with fewer lines (+23 against +42).
- **d:** Lean cost $0.246, with Jev splitting into two shared lanes (the core Jev runs kept one Builder).
- **f (L4 array):** Lean with Jev and a Claude Critic cost $0.352 (+57); Lean with rules only cost $0.052 (+56).
- **Summary.** Lean cuts the diff by 30–50% and cost by 20–30%, with no pass or safety loss, consistent with the Lean round. It is safe to turn on by default for Do chats.

## Involvement level, rules only, Critic provider

| Cell (n=1) | b | c | f |
| --- | --- | --- | --- |
| Balanced (core, n=2) | $0.029 · 22 s | $0.361 · 100 s | $0.263 · 91 s |
| Hands-on | $0.029 · 20 s | $0.322 · 94 s | $0.252 · 135 s |
| Full auto | $0.031 · 23 s | $0.101 · 52 s (Jev chose execute) | $0.236 · 113 s |

- **Level.** It doesn't change quality (all passed) or cost much. Hands-on adds approval clicks (about 1.2× the wall time on f). On c at Full auto, Jev skipped the Architect: $0.10 against $0.36.
- **Rules only** (no Jev, Sonnet pinned): a $0.021, c $0.109, d $0.086, e $0.059, all passing. That is cheaper than Jev's routing on c and d, and the same on a and e.
- **Pinned Sonnet with Jev** (the control): a $0.020, d $0.247, f $0.155.
- **Critic on Claude** (Codex disconnected): f $0.375 against $0.263, and j $0.318 against $0.349. The Claude Critic is Opus, costs about 4× the Codex Critic, and gave longer, positive reviews.
- **L4 on f** (Jev × Lean × Critic):
  - rules only removes about $0.2 (no Architect, no Critic);
  - Lean and the Critic provider barely move cost once rules only is on;
  - all four corners passed.

## Models

| Scenario | Haiku | Sonnet | Opus | Auto (core) | Codex Builder | GLM Builder | Codex low / medium / high (direct) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| b | 1/1 $0.029 | 1/1 $0.037 | 1/1 $0.065 | 2/2 $0.029 | 1/1 $0.000* | 1/1 $0.002 | $0.048 / $0.034 / $0.039 |
| c | **0/1** $0.156 | 1/1 $0.188 | 1/1 $0.363 | 2/2 $0.361 | 1/1 $0.050* · 176 s | 1/1 $0.126 · 205 s | $0.108 / $0.098 / $0.171 |
| e | **0/1** $0.044 | 1/1 $0.090 | 1/1 $0.230 | 2/2 $0.108 | – | 1/1 $0.085 (Claude Critic not run) | $0.041 / $0.089 / $0.061 |
| g | 1/1 $0.066 | 1/1 $0.051 | 1/1 $0.114 | 2/2 $0.115 | 1/1 $0.000* | 1/1 $0.005 | $0.056 / $0.054 / $0.057 |

\* Codex Builder usage is under-counted (below).

- **Haiku** failed both harder tasks. On c it missed float edge cases; on e it broke existing minus-sign parsing.
- **Sonnet pinned** passed everything at about half the Auto cost on c ($0.19 against $0.36: no Opus Architect).
- **Opus** passed everything at 2–3× the Sonnet cost.
- **Codex as Builder** (new in d4c59d3) passed b, c and g, and j twice. j #1 ended "Stopped: the tool calls budget ran out" after 318 s, although the code had passed. Codex Builders are slow (c 176 s, j 209–318 s).
- **GLM-5.3** passed all four at the lowest cost of any Builder (GLM Flash on b and g for under a cent), but c took 205 s.
- **Codex effort** barely matters on small tasks. High effort doubled time and cost on c.

## New scenarios

- **k (Python):** the configured `python3 -m unittest` check ran (0.1 s). The app only auto-detects pytest, so an unconfigured unittest project gets no checks.
- **l (type errors):** `pnpm run typecheck` ran as a check and passed first time. No arm renamed the `Entry.cents` trap.
- **m (accessible toggle), o (upload allowlist):** all harness and Claude runs kept the label, the password rule and every upload guard. Codex missed the toggle state once.
- **p (docs only):** every arm changed only the README.
- **q (rename):** everything passed after the fixture fixes. The harness planned it and cost 4× direct.
- **r (turn 2 reverses turn 1):** passed everywhere. The second turn went through a new plan (v9 in the UI).
- **s (Stop):** Stop was clicked about 53 s in, while the Builder worked. The run ended `cancelled`, and no crew run, worktree, open session, agent process or pending approval remained (2/2). The partial files stay in the working tree, with "Revert to before this run" offered.
- **t (lanes in one file):** passed 2/2 with no conflict (above).

## Bugs and UX problems seen live

Screenshots are in `scratchpad/e2e-live/live/shots` (442 images).

1. **A partly built plan is reported as done** (d #1). One Builder carrying six steps stopped after step 1, and the flow finished with "succeeded". The plan tracker should check that each planned step was reported done, or give the rest to another Builder.
2. **Codex usage is under-counted in harness runs.** Codex Builders record 0 tokens and $0 (j) or about 30 output tokens for multi-tool turns (b, g, $0.00003). Critics record a few thousand tokens against 80–160k for the same model via `codex exec`. `codex-acp` usage appears to cover only the last model call. Cost caps and the Cost tab under-count Codex work.
3. **M6 resume no longer fires across turns under Auto (a regression in d4c59d3),** because the card-driven per-turn model and effort pick changes the settings hash. It worked on 2381803 and 9a932f9, where turn 2 cost $0.015 against $0.045–0.050 now.
4. **Turn-2 cards are hidden or duplicated** (r #2). The plan, check and Keep cards of the second turn were on screen, but the element with the card's anchor id was not visible, which points to a duplicated `approval-<id>` anchor. The runner answered through the API; the Review button in the work panel did nothing visible. Screenshot: `r-baseline-08-missing-plan.png`.
5. **A 404 on every new chat.** The web app fetches `GET /api/conversations/<id>` for a draft chat before it exists (75 of 75 UI cells logged the 404). It is harmless but noisy.
6. **Plan versions inflate.** A first-turn plan reads "Approve the plan v3", and the second turn's reads "v9". Every plan-tool update appears to count as a version.
7. **The Codex Builder's tool-call budget (24) ends a correct run as failed** (j #1).
8. **Postgres connection exhaustion under concurrent test runs.** The API and worker pools (10 each) plus a parallel `test:db` reached `max_connections` 100, and one orchestration died at intake. This is an environment issue, but the worker gives up the run without retrying.

The six dry-run bugs are fixed in d4c59d3 and were not seen again. Checked live: the check approval card appears in the thread ("Run a check? Jev wants to run a project check."), the Keep title is single, no 500 on removed lanes, and there was no snapshot race. Recent-repo ordering was not exercised, because the runner still names repos newest-first.

## Recommendations (ranked)

1. **Verify plan completion before finishing.** When a Builder carrying several steps ends, compare the steps it reports done with the plan. Continue with the rest, or fail loudly. This is the only live quality loss that traces to the harness (d #1), and it is cheap to fix.
2. **Restore cross-turn resume (a regression in d4c59d3).** Keep the turn-1 model for follow-ups in the same chat unless the new request is clearly harder, or leave model and effort out of the resume key when the provider is the same. Resume made turn 2 3× cheaper and about twice as fast on the older versions.
3. **Fix Codex usage accounting** (sum the `usage_update` values, or read the token totals from `codex-acp`), then re-baseline the Codex Critic and Builder costs. Budgets that rely on cost are blind to Codex today.
4. **Use execute depth for mechanical multi-file work.** Renames and type-error fixes with named symbols (l, q) should skip the Architect. That would bring 4× cost to about 1×, and direct passed both in 12–17 s.
5. **Make review requests deterministic.** Add a direct "is this a review request?" question, or a keyword rule ("review this change"). Jev's intent confidence sat at 0.41–0.54 on every R1 run, so the Critic runs about one time in three.
6. **Ask on vague requests.** Raise Balanced's clarify threshold to about 0.75 for requests under ten words with no file or symbol named, or add a "too vague to build" question. Nobody asked on "Make the reports better.", and the harness spent $0.23 building something unrequested.
7. **Prefer lanes on multi-feature plans when Jev is unsure** (0.5–0.65). Both placements pass P1 in about 60 s with zero dependency waits, while one Builder dropped half the plan.
8. **Turn on Lean by default for Do chats.** It cut diffs by 30–50% and cost by 20–30% here, with every safety check passing.
9. **Right-size destructive plans.** Rules-only f passed at $0.05–0.08, against $0.26 with an Opus Architect and a Critic. Consider a Sonnet Architect when the request names the files and the operation, and keep the Critic.
10. **Smaller fixes:** deduplicate the approval anchors on later turns; stop fetching draft chats; count plan versions per approval, not per plan-tool update; raise the Codex Builder's tool-call budget or scale it by effort; retry intake on a transient database error; detect `unittest` projects for checks.

## Reproduce

```sh
git worktree add --detach <scratch>/e2e-live/versions/d4c59d3 d4c59d3   # plus an install
cd <scratch>/e2e-live/versions/d4c59d3
node --env-file=<repo>/.local/credentials.env --import tsx scripts/e2e-live/run.ts \
  --live --budget 40 --dir <scratch>/e2e-live/live --label live \
  --blocks core,scenarios,versions,configs,models,glm --repeats 1
# then --blocks core,scenarios --repeats 2 for the second repeat
```

Omit `--live` for a dry run with the fake agents ($0). `--plan` prints the cells and the expected cost per block.
