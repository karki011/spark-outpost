# Lean build

A discussion paper, written on September 26, 2026 with the first implementation and live runs. It covers the "Lean build" style, where it sits in the harness cycle, what Jev decides and what the user decides, how parallel lanes are placed (shared working tree or worktrees), the Critic's single pass, and what the live runs showed. Status and decisions go to [HARNESS_PLAN.md](HARNESS_PLAN.md#lean-build-and-lane-placement-september-26-2026).

The idea comes from [ponytail](https://github.com/dietrichgebert/ponytail) by Dietrich Gebert, MIT licensed. We read its code and results and wrote our own wording; no ponytail file, prompt or hook is copied or run.

## What ponytail does

Read from its repository (skills, hooks and benchmark results), not only its README.

- **The ladder.** Before writing code, stop at the first rung that holds: does it need to exist at all, is it already in this codebase, does the standard library do it, does the platform do it natively (`<input type="date">`, CSS, a database constraint), does an installed dependency do it, can it be one line, and only then the minimum code. The ladder runs after reading the problem and tracing the real flow, never instead of it.
- **Root cause.** A bug report names a symptom; grep every caller of the function you touch and fix the shared function once.
- **Markers.** A deliberate shortcut with a known ceiling gets a `ponytail:` comment naming the ceiling and the upgrade path. A separate `ponytail-debt` skill greps `(#|//) ?ponytail:` into a ledger and tags markers without an upgrade trigger as `no-trigger`, "the ones that silently rot".
- **Safety floor.** Never simplify away validation at trust boundaries, error handling that prevents data loss, security, accessibility, or anything explicitly requested. Non-trivial logic leaves one runnable check.
- **Intensity.** lite (build what is asked, name the lazier option), full (the ladder enforced, the default) and ultra (challenge the requirement itself).
- **Delivery.** Claude Code hooks: a SessionStart hook injects the skill body, filtered to the active intensity, and a SubagentStart hook injects the same text into every subagent, because session context never reaches subagents (optionally scoped with a matcher). The mode lives in a state flag file; "stop ponytail" only counts as the whole message, after a bug where "add a normal mode toggle" switched it off.
- **Review.** `ponytail-review` hunts complexity only, one line per finding, tagged `delete:`, `stdlib:`, `native:`, `yagni:` or `shrink:`, ending with `net: -N lines possible` or "Lean already". Correctness and security are explicitly out of its scope, and a single smoke test is never flagged.
- **Evidence.** Its agentic benchmark (Haiku 4.5, real Claude Code sessions, `git diff` added lines) found −54% code on 12 feature tickets, from −94% where a native input replaces a hand-built component to about 0% on irreducible CRUD, with lower cost and time. On six adversarial safety tasks ponytail stayed 100% safe; a bare "YAGNI + one-liners" prompt was 95% and dropped a path-traversal guard. An earlier run was contaminated (the hook fired on the baseline too), and with a fair baseline on well-scoped tasks the size gap was small (about 4%). The honest claim is "large where there is bloat to cut, nothing where there isn't, without losing the safety floor".

## Where each piece sits in our cycle

Everything is behind one setting. It was off by default for the A/B runs; since round 7 lean is the default for projects that never chose a style.

| Piece          | Where                                                                                                                                                                                                                                                                                                                   | Off                  | Lite                                                                                | Lean                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setting        | `projects.build_style` (`0029_build_style.sql`; NULL means never set, `0033_lean_default.sql`), `PATCH /api/projects/:id {buildStyle}`, a Build style control under the allowlist in the repo menu                                                                                                                      |                      |                                                                                     | default                                                                                                                                                         |
| Per-task style | `build-style.ts`: the rule, then Jev (below); recorded as a `build_style` decision                                                                                                                                                                                                                                      | no call, no decision |                                                                                     |                                                                                                                                                                 |
| Architect      | `architectPrompt`                                                                                                                                                                                                                                                                                                       | unchanged            | "Reuse: …" on steps                                                                 | rungs 1–2: leave out steps that need not exist, reuse what is here, fewer steps and files, "Reuse: <file or function>" per step                                 |
| Builder        | `builderPrompt` for planned Builders; appended to the request for the in-place Builder                                                                                                                                                                                                                                  | unchanged            | build all of it, name the smaller option in one line, safety floor, `lean:` markers | the full ladder, root cause, safety floor, `lean:` markers with a limit and an upgrade, one runnable check for non-trivial logic, at most three "skipped" lines |
| Critic         | the same single review pass                                                                                                                                                                                                                                                                                             | unchanged            | complexity lens                                                                     | complexity lens                                                                                                                                                 |
| After landing  | `recordShortcuts` at wrap-up: the orchestration's diff is scanned for added comment lines with `lean:` (no AI call), stored as a `shortcuts` artifact and shown in the work panel's Tasks list as "Deferred shortcuts: N marked lean:" with one ledger line per marker (`file:line, limit. upgrade: …` or "no trigger") | nothing              |                                                                                     |                                                                                                                                                                 |

The markers are `lean:` rather than `ponytail:`, and they are comments in the user's project, written by Builders. Spark Outpost's own code keeps its no-comments rule.

## What Jev decides and what the user decides

- **The user** sets the ceiling per project: off, lite or lean. A project that never chose builds lean (the rule's reason reads "default"); an explicit choice is kept. The live e2e run (lean cut diffs by 30–50% and cost by 20–30% with every safety check passing) decided it.
- **The rule** lowers it per turn: not a Do turn gives off; a request that asks for a full-featured, complete, production-ready, comprehensive or polished version gives lite; otherwise the project setting.
- **Jev** answers one choice, "How lean should the code written for `task` be?", offered only the styles up to the project setting. At 0.8 or more its answer acts (the same bar as the cheaper-pick gate); below that the rule's style runs. The decision records the summary "Build style X · rule would have used Y (reason) · Jev said Z at C". Jev is never asked when the project is off, and it can never raise the style above the setting.
- **Jev also decides the lane questions** (below): whether to split chains across parallel Builders and whether they may share the working tree, each with the rule as the fallback below the gate and each recorded next to what the rule would have done.

## The Critic: one pass, two lenses

The Critic's job is an AI review of what landed: correctness, safety and missing requested behaviour first. With lite or lean the same pass also lists complexity findings tagged `delete:`, `stdlib:`, `native:`, `yagni:` or `shrink:` with file and line, and one line `net: -N lines possible` (stored as `net` on the review artifact). Complexity alone never makes the verdict "concerns", so it cannot trigger a fix loop; one small test is never complexity; validation, data-loss handling, security and accessibility are never complexity.

The one-pass rule is unchanged: the Critic runs at most once per landed change, a fix after concerns is not reviewed again (only the checks re-run), and there is no second reviewer. For parallel groups "landed change" now means the merged group when the lanes were small: see below.

## Parallel lanes

### When to split

Round 4 showed that two cold Builders on short chains cost more than one warm Builder in sequence. Now:

- **Rule:** a chain gets its own Builder only when it is large: two or more of its steps (or its only step) are large (Jev's size noul, else the Architect's `Large:` line), or it changes five or more files. Smaller chains run in sequence in one Builder. The Architect's prompt says so.
- **Jev:** the parallel call now also asks "One Builder doing these chains one after another would be as good as parallel Builders" about the candidate chains. Sure yes (certainty 0.75 or more, like the other parallel nouls): one Builder. Sure no: split.
- **Architect (round 7):** when Jev is unsure or does not answer, the Architect's own "Parallel chains: yes" or "Parallel chains: no" line decides, since it read the code. Only when it wrote neither does the size rule apply. The decision records "decided by Jev", "Architect" or "rule".

### Shared tree or worktrees

Lanes that change disjoint files run as concurrent Builders in the same working tree instead of worktree copies. That skips `git worktree add`, dependency preparation and the merge, and keeps the Builders' sessions resumable in the main folder. Since round 7 the shared tree is the default, and a worktree is used only when one of these needs holds (recorded as `need` on the placement decision): `overlapping files`, `unattended Codex` (Codex Builders at Hands-off and Full auto), `destructive work` (a destructive orchestration or a lane that drops, truncates, migrates or deletes files or data), `sensitive files` (a manifest, lockfile or generated file, unless Jev is sure sharing is safe) or `requested`. Config files no longer count as sensitive, and Jev's folder question is asked only when a lane touches a sensitive file. The bullets below describe the round-6 rules this replaced.

- **Hard rule first:** lanes whose declared files overlap (a lane changes a file another changes or reads), a step that does not list the files it changes, or a research lane: never shared.
- **Jev decides the rest:** one noul in the same batched call, "These Builders can work in the same folder at the same time without conflicting", with each chain's steps, changed files and any manifests, lockfiles, config or generated files among them. Sure yes: shared tree. Sure no or unsure: worktrees.
- **Rule fallback** (Jev not connected or not answering): shared unless a lane changes a manifest, lockfile, config or generated file. This is an input to Jev, not an absolute block, as decided.
- The `parallel` decision records both, for example "Chains: split (jev; Jev 0.10 on one Builder; rule: one Builder) · shared tree (Jev is sure the Builders can share the folder; Jev 0.95 on sharing; rule: worktrees)".

**Attribution in a shared tree.** Snapshots and revert assumed one writer per tree: each run's diff in the Changes view runs from its own snapshot to the next run's, so two concurrent writers would show each other's edits. For a shared group the harness now commits the tree before the group, and after it attributes each changed file to the lane that declared it (unclaimed files go to the last lane), builds one synthetic commit per lane (the base plus earlier lanes' files, in run creation order) and re-points each lane's snapshot there. Each Builder's Changes entry then shows only its own files. Keep and revert stay at group level: the keep-or-revert card and "Revert to before this run" act on the orchestration, whose snapshot predates the group. Reverting a single lane run reverts everything since that run started, as it already did for sequential runs. Known limits: attribution trusts the declared files, a failed lane's partial edits stay in the tree for the retry (a worktree would discard them), and two Builders running whole-project commands at once (formatters, installs) can still collide; Jev's question names those risks.

### Checks and review after a group

- **Checks on the merged result** (the round-4 gap): after a group lands, the project's checks run once in the main tree, named after the lanes ("Checks passed for Bolt and Rivet"), with the usual one fix turn. Worktree lanes still run their own checks in their copies first; shared lanes skip per-lane checks, since the tree is shared.
- **One review of the merged diff when the lanes were small:** a worktree lane's diff is reviewed as it lands only when it is over 12 KB (`LANE_REVIEW_BYTES`); otherwise it waits. After the merge, the unreviewed lanes are reviewed together, as one change, when their merged diff fits the Critic's 24 KB patch limit, and one review per lane otherwise. When a lane failed, the lanes that landed are still reviewed this way, and the merged checks wait for the retried step, which runs its own checks in the main copy.

### Dependency preparation in worktrees

A worktree holds only tracked files, so checks and Builder commands that need `node_modules` failed in a copy. Now, when a copy of a Node project is created, preparation starts in the background and the Builder starts at once:

- **pnpm lockfile:** `pnpm install --offline --frozen-lockfile --ignore-scripts` first (the store makes it faster than a clone), then a clone.
- **Otherwise:** a copy-on-write clone of every `node_modules` folder of the main tree (up to three levels deep: `cp -cR` on macOS APFS, `cp -R --reflink=auto` on Linux), then the lockfile's package manager offline (`npm ci --offline`, `yarn install --offline --frozen-lockfile`).
- **Else skipped** with a recorded note. Never a symlink: a Builder installing a package would write into the main tree.
- Only the copy's checks and the Builder's commands (through the approval gate) wait for it; edits never do. `run_worktrees` records the method, time, note and how long anyone waited (`deps_method`, `deps_ms`, `deps_note`, `deps_waited_ms`). Each command is limited to 90 s. Removing a copy first lets its preparation finish (Stop cancels it), then deletes the folder with its `node_modules` and the branch.

### Worktree lifecycle

Every copy has a `run_worktrees` row before `git worktree add`, and is removed with its branch and folder when the group finishes on every path: merged, failed member (before the retry in the main copy), Stop, a merge conflict kept either way or reconciled, and after a crash by the worker's recovery sweep of rows whose orchestration ended. DB tests cover each path, including that the cloned `node_modules` is gone.

## Live results

All runs in scratch repos of the Ledger Lite fixture, harness mode, Full auto, Auto routing with Jev, one Sonnet or Haiku Builder unless noted. Total live spend: **$2.80** of the $3 cap. One run per cell except L1 and L2 (two). Treat differences under about 1.3× as noise.

### A/B: build style off vs lean

L1 and L2 are new over-build tasks with hidden safety checks: L1 "add a date of birth field to this small React signup form" (the checks require `parseSignup` to reject malformed dates and the field to have an accessible label), L2 "cache the responses of `fetchRates`" (a failed response or a network error must not be cached).

| Task                  | Arm  | Pass | Safety checks | Lines added (all / source) | Cost   | Wall    | `lean:` markers |
| --------------------- | ---- | ---- | ------------- | -------------------------- | ------ | ------- | --------------- |
| L1 date field         | off  | 2/2  | 2/2 runs      | 47 / 15                    | $0.111 | 35.5 s  | 0               |
| L1 date field         | lean | 2/2  | 2/2 runs      | 25 / 8                     | $0.085 | 58.1 s  | 0               |
| L2 cache              | off  | 2/2  | 2/2 runs      | 61.5 / 17                  | $0.099 | 39.8 s  | 0               |
| L2 cache              | lean | 2/2  | 2/2 runs      | 20.5 / 8.5                 | $0.108 | 30.5 s  | 1 per run       |
| H1 half-cent rounding | off  | 1/1  | –             | 25 / 14                    | $0.375 | 100.5 s | 0               |
| H1 half-cent rounding | lean | 1/1  | –             | 13 / 13                    | $0.333 | 73.7 s  | 0               |
| H3 ledger migration   | off  | 1/1  | –             | 183 / 89                   | $0.139 | 49.0 s  | 0               |
| H3 ledger migration   | lean | 1/1  | –             | 126 / 63                   | $0.140 | 58.3 s  | 0               |
| H4 line totals        | off  | 1/1  | –             | 88 / 20                    | $0.129 | 48.6 s  | 0               |
| H4 line totals        | lean | 1/1  | –             | 56 / 18                    | $0.128 | 56.2 s  | 0               |
| T1 two typos          | off  | 1/1  | –             | 2 / 2                      | $0.023 | 11.1 s  | 0               |
| T1 two typos          | lean | 1/1  | –             | 2 / 2                      | $0.024 | 16.1 s  | 0               |
| **Sum of task means** | off  | 8/8  | 4/4           | 406.5 / 157                | $0.876 | 284.5 s |                 |
| **Sum of task means** | lean | 8/8  | 4/4           | 242.5 / 112.5              | $0.818 | 292.9 s |                 |

- **Code:** −40% lines added overall (−28% source, −48% tests), from −67% on L2 and −47% on L1 to 0% on T1. Lean wrote fewer tests: 15 new test cases over its 8 runs against 33 for off (H1 lean added none and relied on the existing suite).
- **Cost and time:** −7% cost, +3% wall time: noise at this sample size. H1 planned with an Opus Architect in both arms; everything else ran one in-place Builder.
- **Safety:** every run passed its hidden safety checks. Both arms used `<input type="date">` with a label; nobody built a picker, so L1's over-build trap did not trigger on Sonnet (as ponytail found for well-scoped tasks). One real difference the checks did not test: lean's L1 validation (`Date.parse` after a pattern) accepts impossible days such as 1990-02-30, while one off run checked the calendar day. In L2, one off run cached the promise per fetcher and evicted failures (safe against concurrent duplicate calls); both lean runs cached values in a plain `Map` and marked it `// lean: in-memory only; upgrade: add TTL/eviction …`, which the harvest picked up.
- **Jev's style choice:** Jev answered "lean" on all 8 lean runs (0.61 on H3 and 0.75 on T1, so the rule ran there; 0.93–0.98 elsewhere). No task asked for a complete version, so lite was never chosen. The extra call cost about $0.00002.
- **Critic lens:** no run was reviewed (no task asked for review and depth never included it), so the complexity lens and the `net:` line are covered only by the DB and browser tests.

### P1: shared tree vs worktrees

P1 (two independent three-step features), both forced to split (`--split any`) so the placement is the only difference; build style off.

| Placement             | Pass | Cost   | Wall    | Architect              | Bolt           | Rivet           | Checks                    |
| --------------------- | ---- | ------ | ------- | ---------------------- | -------------- | --------------- | ------------------------- |
| Shared tree           | pass | $0.390 | 85.0 s  | Sonnet, 37.1 s, $0.148 | 37.5 s, $0.105 | 45.1 s, $0.137  | one merged round          |
| Worktrees             | pass | $0.317 | 229.1 s | Sonnet, 69.2 s, $0.113 | 37.4 s, $0.106 | 154.6 s, $0.098 | one per copy, then merged |
| Round 4 (worktrees)   | pass | $0.376 | 89.3 s  |                        |                |                 | per copy                  |
| Round 3 (one Builder) | pass | $0.28  | 93.8 s  |                        |                |                 | –                         |

Jev said the Builders could share the folder at 0.96 both times and was unsure (0.56–0.58) whether one Builder would do; without the forced split the rule would have kept one Builder. The worktree run's time is dominated by one slow Builder (Rivet, 7 tool calls, fewer tokens than in the shared run) and a slower Architect, not by worktree setup; with one run each this shows the shared tree working end to end (attribution, merged checks) rather than a speed-up. Costs are within noise.

### Dependency preparation timings

No AI cost. macOS 15 on an Intel Mac, APFS, warm package caches.

| Project                                                          | `node_modules`         | Fresh install | APFS clone  | Offline install |
| ---------------------------------------------------------------- | ---------------------- | ------------- | ----------- | --------------- |
| pnpm, 5 dependencies (react, react-dom, zod, typescript, vitest) | 2,127 entries          | 0.46 s        | 0.75 s      | 0.43 s          |
| npm, same dependencies                                           | 1,815 entries          | 5.6–9.4 s     | 0.49–0.56 s | 1.48–1.67 s     |
| Spark Outpost itself (pnpm monorepo, 4 `node_modules` folders)   | 29,503 entries, 950 MB | –             | 13.4 s      | 2.3 s           |

A clone is per-file work on APFS, so it scales with the number of files; pnpm's offline install hard-links from the store and is 6× faster on the monorepo. Hence pnpm installs first and everything else clones first. Since preparation now runs beside the Builder, these seconds only matter when a check or command needs `node_modules` before they are done.

## Open questions

1. **Default.** Decided in round 7: lean is the default for projects that never chose a style. The Lean-round runs showed less code, no safety loss on the checks we had, and no cost change; they also show one looser validation that a stricter hidden check would have caught.
2. **Validation floor.** Should the lean prompt name "validate the full format, including calendar ranges" for dates and similar, or should that stay a Critic finding?
3. **Projects that forbid comments.** Spark Outpost's own AGENTS.md forbids explanatory comments, which conflicts with `lean:` markers. Should Builders put shortcuts in their reply (and the harvest read the reply) when a project forbids comments?
4. **Critic lens without a review.** Most lean runs have no Critic. Should lean add a complexity-only pass for large diffs, or stay with "the lens rides along when a review is wanted"?
5. **Shared-tree hazards.** Should the harness refuse whole-project commands (formatters, installs) from a Builder in a shared group, or leave it to Jev's question and the merged checks?
6. **Split noul.** Jev was unsure on P1 twice. Is the rule (two large steps or five files) the right fallback, or should the Architect be asked for an expected duration per chain?
7. **Sample size.** One or two runs per cell. A second round with n=3 on L1, L2, H3 and P1 (placement unforced) would settle the defaults.
