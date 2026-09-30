# Coordinator plan

Proposed on September 28, 2026. Design and implementation plan for **coordinator delegation**: one coordinator plans a story, splits it into Builder-sized pieces with declared file ownership, places each piece (one Builder in order, shared-tree Builders, or worktree Builders), steers them while they run, integrates their work as the only writer, runs the full checks and the Critic once, and reports. Phases C0–C5 are built (see "Status" below); C6–C8 are not.

Read with [HARNESS_PLAN.md](HARNESS_PLAN.md) (the lean harness that runs today and the "Removed in round 10" table), [ROUTING_PLAN.md](ROUTING_PLAN.md) (code scan, Builder floor, complexity rule), [LEAN_BUILD.md](LEAN_BUILD.md) (the old lane placement and shared-tree attribution) and [LEAD_MODE.md](LEAD_MODE.md) (a future design this plan replaces for large work). Evidence: [dev-day-2026-09-28.md](../benchmarks/dev-day-2026-09-28.md), [dev-day-2026-09-28-rerun.md](../benchmarks/dev-day-2026-09-28-rerun.md), [routing-live-2026-09-27.md](../benchmarks/routing-live-2026-09-27.md), [harness-e2e-lean-2026-09-27.md](../benchmarks/harness-e2e-lean-2026-09-27.md).

## Status (September 30, 2026)

Built: C0 (contracts, validation, size, placement ladder, `coord-1` thresholds), C1 (shadow `parallel` rows, `pnpm coord:shadow`), C2 (pieces in order), C3 (ownership and git guards), C4 (shared-tree parallel) and C5 (worktree parallel). The worker's mode is `COORDINATOR_MODE` (`off`, `shadow`, `in_order`, `parallel`), default `shadow`. Parallel placement needs both `COORDINATOR_MODE=parallel` and the project flag `projects.parallel_pieces` (default off; migration `0069_parallel_pieces.sql`, which also adds `projects.piece_slots`, 1–3, default 3). Without the flag, `parallel` behaves as `in_order` and the list says "parallel pieces are off for this project". Neither project setting has a UI yet (like `builder_env` and `stable_checkout`). The browser server runs `parallel`. Spark off never engages the coordinator or records a shadow row. Migrations `0063_coordinator.sql`, `0069_parallel_pieces.sql`.

What C4 and C5 built, and where:

- **Placement at write time** (`coordinator/place-list.ts`): the ladder runs on the validated pieces with the same project facts the shadow row uses; the list and each piece store the placement and its reason.
- **Slots** (`orchestration/slots.ts`, restored): `PARALLEL_AGENT_LIMIT` (default 6) caps Builders per worker; each task gets `piece_slots`, or one slot while its provider has an open rate-limit or usage-limit issue.
- **The ready-set scheduler** (`coordinator/schedule.ts`, `run-pieces.ts`) runs every placement, in order being one slot: pieces whose dependencies landed start in dependency order, up to the slots; after a failure, Stop or a budget cut nothing new starts and the running pieces finish; two ownership strikes narrow the rest to one piece at a time. Each Builder gets its slot as `SPARK_BUILDER_SLOT`.
- **Shared tree** (`coordinator/shared-landing.ts`, `projects/shared-tree.ts` restored): a group base is committed once per task; each piece's diff check ignores files other pieces own; at every landing the piece runs' snapshots are re-pointed (base plus the files of pieces whose last run came earlier), so Changes shows each Builder only its files. Files no piece owns go to the piece that landed last.
- **Worktrees** (`coordinator/group.ts`, `merge.ts`, `migrations.ts`): each piece gets a copy from the current main (`copyFor` from `solo-copy.ts`, dependency prep started at once; scoped checks wait for it). The copy lands as soon as its scoped checks pass: colliding migration numbers are renumbered in the copy, the copy is committed, merged into main (`tryMerge`, `applyTree`) and removed; the other running copies get main merged in at their next turn boundary (their base moves, so their Changes stay theirs), with the notice in their next fix turn. A conflict goes to the integrator (`${taskId}:integrator`) with both sides' diffs, twice at most (a reply starting "Unresolved:" or failing scoped checks counts as not settled); then the `merge_conflict` card at Review each step and Automatic, and a stop with the conflict in the report at Full auto → PR. A budget cut keeps the cut pieces' copies so Continue resumes them in place; Stop, failure and the end of the task remove them, and the worker's orphan sweep removes what a crash left.
- **Main is the chat's root**: in a chat worktree the copies live under `<chat worktree>/.spark/worktrees/` and land into the chat worktree, never the user's checkout.
- **The piece-list card** (`checkpoint` kind `pieces`: Build it, Build in order instead, Revise with a note, Stop) is asked at Review each step for a shared or worktree list or 5+ pieces; the proposed list shows on the board meanwhile. Revise re-runs the coordinator turn with the note as a new list version. Automatic and Full auto approve by level and show the board read-only.
- **UI**: shared-tree and worktree Builders fold into one "Working in parallel" group in the crew turn (restored `ParallelGroup`), each head labelled with its piece and placement; the Agent TV list shows the same label; the report names the placement and lists merge conflicts and renumbered migrations.
- **Budget Continue** resumes cut pieces in their own sessions (`resume` now builds in pieces while any piece is open); pieces that never started begin fresh.

Where the build departs from this plan:

- **No Jev questions yet.** `too_big`, `split_worth_it` and `same_folder` are not asked; the ladder takes their answers as inputs (null today), and the shadow row records whether the size estimate sat in the `too_big` band.
- **Order with the intent flow.** Clarify (when vague) and plan first (for big requests, including most requests that ask to be split up) run before the coordinator. The plan the user approves at "Build this plan?" is the latest approved plan document, so the coordinator reads it: its open items count towards engaging, the coordinator prompt carries it as `## Agreed plan`, validation requires every open item to have a piece, and the piece list records that plan version.
- **The coordinator turn is a fresh Ask session** (`${taskId}:coordinator`), not a resume of the session that wrote the agreed plan. The repair re-prompt repeats the full prompt with the validator's errors, so it works with or without a resumed session.
- **The piece-list card** comes with C4 (above); the piece-list versions a steer creates come with C7, and `piece_notes` is unused. The merge-main notice is part of the next fix-turn prompt, not a `piece_notes` row.
- **The integrator is a Builder turn recorded with the `integrator` role** and `resumeKey ${taskId}:integrator`; after integration every later Builder turn of the task (full-check fixes, Critic fix rounds, continues) runs in that session. The flow machine still treats these as Builder turns.
- **Research pieces** run as Scout-role child runs in Ask mode, one at a time, and their replies reach later pieces as "Notes from Scouts".
- **Pieces follow the task's copy.** When the level or mode needs a task copy (only when the chat works in place: Full auto → PR, a mode that skips the gate, destructive work, a busy repo), every piece runs in that one copy, in order, and it merges back once at the end; parallel placement is not used there. Chats in their own worktree (the default) never need a task copy.
- **Live updates ride on the orchestration snapshot**: `Orchestration.pieces` carries the current list, so there is no separate `pieces` activity type. `GET /api/tasks/:id/pieces` returns the list; `POST …/notes` is C7.
- **Scoped checks** must name a path or package, run a test runner or one of the project's check programs, and not install, format or change files. They still go through the approval gate like any command.
- **`task_pieces.check_status`** records each piece's scoped-check result for the board and the report (not in the section 8 schema).
- **Repair budget.** Two fix turns per piece and two integration rounds are enforced; the "all repair at most half the story budget" cap is not.
- **Ownership strikes.** Two violations in a story narrow the rest of a parallel story to one piece at a time; in a shared tree a Builder's shell write to a file another piece owns cannot be told from that piece's own edit, so the diff check leaves it (the gate still refuses direct edits).
- **No main-tree shortcut.** A worktree piece that starts while nothing else runs still gets a copy (section 2's exception for the last piece of a chain is not built), and research pieces run in the main tree whatever the placement.
- **Migration renumbering** renames the colliding file only; references to the old name elsewhere are left to the integrator's full-check fixes, and the piece's `filesChanged` records the new name.

## Decisions in one place

1. **The default does not change.** A request that fits one Builder runs exactly as the lean harness runs it today: one task-scoped Builder, checks with fix turns, the verified cascade, the Critic by rule. The coordinator adds nothing to it, not even a model call.
2. **Decomposition and parallelism are separate decisions.** A story that is too big for one Builder is always split into pieces. Pieces run **in order by one Builder at a time** unless the placement rule finds at least two independent, large pieces. Round 10 showed that small parallel work is not faster (57 s against 60 s); this plan only parallelises work measured in tens of minutes.
3. **Builder-sized** means the piece fits one Builder session under the smaller of 50% of the model's context window and 150K tokens. A Builder at 75% of its window hands off to a fresh Builder on the same piece.
4. **Every piece declares the files it owns.** The approval gate refuses a Builder's edit outside its piece's files; a diff check after every turn catches writes that bypassed the gate (shell redirects, formatters). Builders never run `git stash`, `checkout`, `switch`, `reset`, `restore`, `clean`, `commit`, `merge` or `rebase`.
5. **One writer integrates.** Builders land their own files; only the coordinator's integrator merges copies, resolves conflicts, renumbers migrations and fixes what the full checks find. Pieces run scoped checks only; the full checks run **once on the integrated result**, then the Critic once.
6. **The dependency graph is validated in code.** `dependsOn` must name existing pieces, be acyclic, and cover every file two pieces both touch. The code scan adds edges it can prove (an import from another piece's owned file); it never removes one.
7. **Approval is bound to a plan version.** The piece list records the `plan_documents` version and a hash of the pieces. A change to ownership, dependencies or pieces is a new version; at Review each step it needs a new approval.
8. **Repair has a budget.** Two fix turns per piece, two integration repair rounds, three Critic rounds (unchanged), and all repair together at most half of the story's budget. A budget cut after a passing state keeps that state (the N2 rule).
9. **Builders never run on the fast tier** (Sonnet by default, the top tier for complex pieces, `model-floor.ts` and `builder-complexity.ts` unchanged). The Critic runs on a different provider from the Builders whenever more than one is connected.
10. **Cards follow the harness autonomy.** Review each step sees the piece list and the conflicts it cannot avoid; Automatic sees only risky or failed states; Full auto → PR sees nothing and ships a draft PR with the piece report in its body.
11. **We turn it off on evidence.** If the story benchmark does not show parallel placement at least 30% faster at the same pass rate and no worse cost per pass including the developer's time, parallel placement stays off and only "pieces in order" remains (section 10).

## What the coordinator in this session did, and what it maps to

The design copies how the Claude coordinator ran the development of Spark Outpost itself on September 27–28 (the dev-day fixes, the benchmark branches, this plan). Every row is a behaviour that worked there, and its Spark mechanism.

| In this session                                                                                            | In Spark Outpost                                                                                                           |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Read-only research subagents ran in parallel with no worktree                                              | Read-only pieces run as Scouts in Ask mode in the main tree, up to 3 at once (section 2)                                   |
| Long builders (30–70 min, repo-wide test suites, the user's dev app running on `main`) each got a worktree | Worktree placement for long pieces, pieces with repo-wide checks, and projects whose checkout must stay stable (section 2) |
| Small edits the coordinator made itself                                                                    | The integrator: one Builder session per task, the only writer during integration (section 3)                               |
| Every brief set file boundaries ("stay in these files")                                                    | `owns` per piece, enforced by the approval gate and a diff check (section 3)                                               |
| Every brief forbade `git stash`, `checkout`, `reset`                                                       | A Builder git-op refusal in `decide()` and Claude deny rules (section 3)                                                   |
| Each agent got its own test database and ports                                                             | A per-Builder slot in the agent's environment and a check lock per project (section 3)                                     |
| The coordinator merged, resolved conflicts, renumbered migrations                                          | Merge in dependency order with the kept `worktrees.ts`, integrator on conflict, migration renumbering in code (section 4)  |
| The coordinator ran the full suites                                                                        | Full checks once on the integrated result, never inside a piece (section 3)                                                |
| The coordinator steered running agents: "merge main", "skip N4", new requirements                          | Piece notes delivered at the next turn boundary, or cancel and resume for urgent ones (section 6)                          |
| The coordinator wrote the final summary                                                                    | The coordinator's report: pieces, placement, providers, checks, Critic, cost, what is left (section 1)                     |

What the session also taught, from the memory file `shared-tree-agent-rules.md`: one agent's plain `git stash` once stashed three agents' uncommitted work, and concurrent full suites exhausted Postgres connections. Both are designed out below, not left to prompts.

## 1. The coordinator role

**Who.** The coordinator is the orchestrator (`apps/server/src/orchestration/orchestrator.ts`) with Jev as its advisor. The orchestrator's code owns every decision that has a rule; it uses a model only to write the piece list, and Jev only in unsure bands. There is no Architect: the round-10 lesson was that a separate cold planner cost 34–77% of a planned turn. The piece list is written by a **coordinator turn**, a read-only turn that resumes the session that wrote the agreed plan when there is one (warm cache, no re-reading), otherwise a fresh Ask-mode session on the chat's provider.

- **Coordinator turn.** Role `coordinator`, `resumeKey = ${taskId}:coordinator`, Ask mode (reads only, `git diff` and `git log` allowed as today), the chat model on Auto with the Builder floor and the complexity rule applied. Its prompt asks for one fenced `pieces` block (schema in section 8) and nothing else. One repair re-prompt with the validator's errors; still invalid means one Builder in order with the agreed plan, and the reason is recorded.
- **Jev.** Answers, in the intake batch or one batched call after the piece list, only what code cannot settle: `too_big` ("Is this change too large for one agent session?", asked only when the size estimate is within 20% of the Builder budget), `split_worth_it` ("Would two agents working at the same time finish sooner without more rework?", asked only when the placement rule is in its unsure band), and `same_folder` (the round-7 question, asked only when pieces touch a file the shared-tree blockers name). Each acts at 0.8 either way, as every Noul does since round 10; below that the rule decides. Records go to `run_advice` purpose `parallel`, which the CHECK constraint already allows.

**What it owns.**

| Owned by the coordinator                                                                                                                                        | Where it lives                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| The plan: the latest approved `plan_documents` version, or the coordinator turn's own plan saved as proposed                                                    | `plans/`, `plan-documents.ts` (unchanged)                                                               |
| The piece list: key, goal, owned files, reads, `dependsOn`, contract, acceptance, scoped checks, size                                                           | new `task_pieces` table (section 8)                                                                     |
| Placement per piece: in order, shared tree, worktree, read-only                                                                                                 | `coordinator/placement.ts` (new)                                                                        |
| Provider and model per piece                                                                                                                                    | `coordinator/assign.ts` (new), reusing `routing.ts`, `model-floor.ts`, `builder-complexity.ts`          |
| Scheduling: the ready set by `dependsOn`, at most 3 concurrent Builders per task and a per-worker agent limit (`PARALLEL_AGENT_LIMIT`, restored from `06db4c6`) | `coordinator/schedule.ts` (new) with `Slots` restored from `06db4c6`                                    |
| Integration: attribution, merges, conflict resolution, migration renumbering                                                                                    | `coordinator/integrate.ts` (new) over the kept `projects/worktrees.ts` and `orchestration/solo-copy.ts` |
| The full checks on the integrated result, then the verified cascade and the Critic                                                                              | `checks.ts`, `verify.ts`, `review-loop.ts` (unchanged)                                                  |
| Steering running Builders, and the user's messages while the task runs                                                                                          | `coordinator/steer.ts` (new)                                                                            |
| The final report                                                                                                                                                | `coordinator/report.ts` (new), feeding `final-message.ts` and the PR body                               |

**When the coordinator engages.** First match, after intake and the risky-change card:

1. The user asks for it ("split this up", "use parallel Builders", "in worktrees", the "Pieces" option in the composer's Plan menu). Recorded as `requested`.
2. The agreed plan has 4 or more open items across 2 or more areas (a workspace package or top-level folder, `areaOf` in `critic-rule.ts`).
3. The code scan's ranked likely files, above the probability cut from the dev-day issue 3 fix, number 12 or more or span 3 or more packages.
4. The size estimate for the whole request is over the Builder budget (section 2).
5. Otherwise: today's lean path, no coordinator turn, no pieces.

A story the coordinator engages for but that comes back as one piece runs as one Builder with the piece's contract as its brief. That wastes one coordinator turn; the benchmark counts it.

**The report.** One reply at the end, built by code from the records, not by a model: a table of pieces (title, Builder name, placement, provider and model, status, files, scoped check result, cost), the integration steps (merges, conflicts and who resolved them, renumbered migrations), the full check lines, the verified cascade's verdict, the Critic's findings and fix rounds, skipped pieces with the reason, and "Incomplete: …" for anything not landed. Full auto → PR puts the same table in the PR body under the summary.

## 2. Placement rule

Placement runs after the piece list is validated and again whenever a piece becomes ready. It is a pure function, `placePieces(pieces, facts) → PiecePlacement[]` in `coordinator/placement.ts`, with every threshold in `advisor/policy.ts` beside the others (policy `coord-1`). All thresholds are provisional until the story benchmark (section 9) tunes them.

### Inputs

- **The piece list**: owned files (globs expanded against `git ls-files` plus new paths), reads, `dependsOn`, scoped checks, the coordinator's size label (S, M, L).
- **The size estimate** per piece (`coordinator/size.ts`): `12K + 2 × tokens(owned files) + tokens(read files) + 6K per owned file`, where a file's tokens are its line count × 12 from the scan's `line-counts.ts`. Calibrated after phase C1 against the peak `contextUsed` recorded per Builder run.
- **The Builder budget** per candidate model: `min(0.5 × contextSize, 150K)` from the model cards.
- **Project facts**: git or not; `repoBusy` (another Do task in the repo); the harness autonomy; destructive or migration work (`risk-rules.ts`); a provider mode that skips the approval gate (`modeNeedsWorktree`); whether the project asks for a stable checkout (the new project setting in section 3); the check commands and whether they are whole-project.
- **Jev**: `too_big`, `split_worth_it`, `same_folder`, only in their unsure bands.

### Definitions

- **Large piece**: size estimate at least 40K tokens, or 5 or more owned files, or label L. About 5 minutes of Builder work and up.
- **Long piece**: size estimate at least 90K tokens, or label L with a whole-project check. About 20 minutes and up.
- **Independent**: no path in the `dependsOn` graph between the two pieces, and no overlap between their owned files (after glob expansion).
- **Critical-path saving**: `1 − (longest dependency chain by size) / (sum of all piece sizes)`.

### The ladder (first match wins per story; recorded as a `parallel` decision)

| #   | Placement                                              | When                                                                                                                                                                                                                                                                                                                                                                             | Why                                                                                                                                                                                  |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | **One Builder** (no pieces)                            | The coordinator did not engage                                                                                                                                                                                                                                                                                                                                                   | Today's lean path                                                                                                                                                                    |
| 1   | **Pieces in order** (one Builder at a time, main tree) | Outside git; or fewer than 2 independent large pieces; or critical-path saving below 35%; or Jev `split_worth_it` ≤ 0.2                                                                                                                                                                                                                                                          | Round 10: parallel small work was not faster, and one Builder with checks is the strong baseline                                                                                     |
| 2   | **Worktree Builders**                                  | Parallel is worth it and any piece that runs at the same time as another: is long; owns a shared-tree blocker (manifest, lockfile, generated file, or a file in a migrations folder); is destructive; runs in a mode that skips the approval gate; runs a whole-project check or mutator (formatter, codegen, install); or the project asks for a stable checkout; or `repoBusy` | These are the cases where a half-done neighbour breaks your checks or two writers meet on one file; the session's 30–70 min builders were all here                                   |
| 3   | **Shared-tree Builders**                               | Parallel is worth it and none of row 2 holds; Jev `same_folder` ≥ 0.8 when a piece touches a blocker file that the rule would otherwise send to a worktree                                                                                                                                                                                                                       | No worktree setup, no dependency prep, no merge; sessions stay resumable in the main folder (LEAN_BUILD §P1: 85 s shared against 229 s in worktrees, n = 1, mostly one slow Builder) |
| —   | **Read-only pieces**                                   | Pieces marked `research`, placed independently of the above: Scouts in Ask mode in the main tree, up to 3 at once, before the Builders that depend on them                                                                                                                                                                                                                       | Reading never conflicts; findings reach dependents as "Notes from Scouts" (4,000 characters)                                                                                         |

Placement is per story, not per piece, with one exception: once a story is on rows 2 or 3, a piece that becomes ready while nothing else is running runs in the main tree even on row 2 (no neighbour, nothing to isolate from), unless it is destructive or runs in a mode that skips the approval gate. That keeps the last piece of a chain from paying for a worktree.

### How Jev, the code scan and the plan inform it

- **The plan** gives the pieces their order and scope. A piece list that contradicts the agreed plan (a plan item with no piece, or a piece outside every item) fails validation once and is re-prompted; still wrong goes on with the gap listed in the report.
- **The code scan** validates ownership (paths exist or sit under an existing folder, none are secret files, `isSecretPath`), expands globs, adds `dependsOn` edges when a piece's owned file imports a symbol defined in another piece's owned file and that piece changes it (`contract` names it), and supplies line counts for the size estimate. Scan evidence only ever adds edges or moves a piece towards isolation.
- **Jev** is asked only in the unsure bands above. It never moves a piece from a worktree to the shared tree on its own when a row-2 condition other than a blocker file holds.

### When to fall back

| Trigger                                                | Fallback                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Piece list invalid after one repair                    | One Builder in order with the agreed plan                                         |
| `git worktree add` or the group base commit fails      | That piece and later ones: in order in the main tree                              |
| Dependency prep fails and a check needs `node_modules` | Piece moves to the main tree and waits its turn                                   |
| Two ownership violations in one story (section 3)      | Rest of the story: pieces in order                                                |
| An integrator turn fails twice on a conflict           | The conflict card at every level except Full auto → PR, which stops and reports   |
| A provider becomes unavailable                         | Section 5                                                                         |
| The story budget is 80% spent with pieces not started  | No new parallel starts; the rest runs in order, and the budget card asks as usual |

## 3. Shared-tree Builders

Several Builders work in the user's main working tree at the same time, each on its own piece.

**Ownership, enforced in the approval gate.** `DecideOptions` in `approvals/decide.ts` gains `owned?: OwnedFiles` (the piece's expanded owned paths and globs, plus the piece key and the other pieces' owners for the message). `refusal()` rejects any `edit` request whose paths fall outside `owned`, with the reason "Rivet owns `apps/web/src/tags/TagChips.tsx`; this piece owns …; ask the coordinator in your reply if you need it changed". The same check runs where `approval-gate.ts` short-circuits `write_text_file` requests covered by an earlier grant, so an fs write cannot slip past it. Codex Do actions already all go through the gate; Claude's Edit and Write tools arrive as ACP permission requests or client fs writes, both of which reach `decide()`. This is the same hard-rule layer as `BUILDER_PUBLISH_REASON`, so it applies in every agent mode and at every harness autonomy, Full auto → PR included.

**What the gate cannot see.** Shell commands write files too (`sed -i`, `>`, a formatter). Two guards:

- Commands whose write targets `command-kinds.ts` can name (redirects, `sed -i`, `mv`, `cp`, `rm`, `touch`, `tee`) are checked against `owned` the same way; unknown mutators are asked at Review each step and allowed elsewhere, as today.
- **Diff check after every Builder turn** (`coordinator/ownership.ts`): the tree's changes since the piece's last land are compared with `owned`, using the shared-tree snapshot from `projects/shared-tree.ts`. A change outside `owned` that no other running piece owns is a violation: at Review each step a card ("Rivet changed `package.json`, which no piece owns: Keep it in Rivet's piece, Revert that file, Stop"); at Automatic and Full auto → PR the file is moved into the piece when no other piece owns it and it is not a blocker file, otherwise reverted from the snapshot and the Builder is told in its next turn. A change to a file another running piece owns is always reverted and noted. Two violations in a story switch the rest to pieces in order.

**No git operations.** A new `BUILDER_GIT_REASON` refusal in `decide()` for Builders of a coordinated task: `git stash`, `checkout`, `switch`, `reset`, `restore`, `clean`, `commit`, `merge`, `rebase`, `cherry-pick`, `am`, `worktree` and `branch -d/-D`. Read-only git (`status`, `diff`, `log`, `show`) stays allowed. Claude Builder sessions get matching `permissions.deny` rules beside `BUILDER_PUBLISH_DENY_RULES` in `agents/acp/agents.ts`. The Builder prompt says: "Use `git diff` and `git show HEAD:<path>` for baselines; never change the index, the branch or the stash." Builders in coordinated tasks do not get the `Agent` tool from repo agent config: the coordinator owns delegation.

**Scoped checks only, and a check lock.** Each piece declares its scoped checks (a single test file, a package's unit tests, a type check of its package). The harness runs only those after the piece's turns, never the project's full checks, so a neighbour's half-done edit cannot fail it. A scoped check must be a project check command narrowed by path, or on the allowlist. Whole-project commands (the full `pnpm check`, installs, formatters over the repo) are refused inside a piece with "the coordinator runs the full checks after integration".

- **Per-Builder environment.** Every Builder's agent process and its check commands get `SPARK_BUILDER_SLOT` (1–3) and `SPARK_BUILDER_NAME`. A new project setting, **per-Builder check environment** (`projects.builder_env`, a small map with `{slot}` substitution such as `TEST_DATABASE_URL=…_test_b{slot}`), lets a project give each Builder its own test database and ports; for Spark Outpost's own repo that is `TEST_DATABASE_URL` and `SPARK_TEST_PORT_SLOT`, which `tests/browser/stub-config.ts` already derives ports from.
- Without that setting, scoped checks of different pieces take a **check lock per project** (one Postgres advisory lock keyed by the project) so two suites never share a database at once. Scoped checks are short, so the lock costs little.

**Attribution per Builder.** Restored from `06db4c6`: `projects/shared-tree.ts` (`attributeFiles`, `commitWithFiles`, `laneSnapshots`) and `attributeShared` in `orchestration/group-landing.ts`. The harness commits the tree as the group base before the first shared Builder, and when each piece lands it builds one synthetic commit per piece (the base plus earlier pieces' files, in landing order) and re-points the piece run's snapshot there. With declared ownership enforced, "attribution trusts the declared files" (LEAN_BUILD's known limit) becomes true by construction. The Changes view then shows each Builder only its own files; Keep and Revert stay at task level.

**Landing, the integrator and the Critic.**

1. A piece lands when its Builder's turns end with its scoped checks green (or after its 2 fix turns): ownership diff check, attribution commit, piece status `landed`, dependents become ready.
2. When every piece has landed or been skipped, the **integrator** runs: one Builder session per task, `resumeKey = ${taskId}:integrator`, owning every file (the only unrestricted writer), started only when no piece is running. Its first turn runs only if integration needs edits: glue the coordinator listed in the piece list's `integration` note, or a contract mismatch between pieces. It is also the session for full-check fix turns.
3. The **full checks** run once on the integrated tree (`runChecks` with the project's check commands). Failures go to the integrator as fix turns: at most 2 integration repair rounds.
4. Then the unchanged tail: plan completion, the verified cascade on the whole diff, the Critic (section 5) with its fix loop run by the integrator (not the piece Builders, which are closed by then), the keep card per level, and Ship for Full auto → PR.

## 4. Worktree Builders

**Reused as is** (today's code, kept through round 10 for solo copies):

- `projects/worktrees.ts`: `addWorktree`, `commitWorktree`, `groupBase`, `excludeSparkDir`, `tryMerge` (`git merge-tree --write-tree`), `applyTree` (apply to the working tree, never the index), `takeFileFrom`, `fileDiff`, `pinSnapshot`, `removeWorktree`, `branchName` (`spark/<task>/<name>`), `RESULT_REF_PREFIX`.
- `orchestration/solo-copy.ts`: the copy lifecycle for one Builder, `mergeConflictCard` use (Keep your version, Keep Bolt's, Stop), `cleanupCopies` and `cleanOrphanedCopies` (the worker's orphan sweep), `Session.copyMerged` so later rounds merge from the last merged result.
- `projects/deps-prep.ts` and `projects/worktree-deps.ts`: `node_modules` beside each copy (APFS clone, else offline install, else skipped with a note); only checks and Builder commands wait for it.
- `persistence/worktrees.ts` and the `run_worktrees` table (`0021_parallel.sql`): the row is written before `git worktree add`, so every copy on disk has a row.
- Contracts: `copy` on crew members, changes and check bodies ("Checks failed for Rivet's copy").
- Ship's guard: internal commits (`HARNESS_COMMIT_EMAIL`) and `spark/<id>/<name>` branches are never pushed.

**Restored from `06db4c6`** (`git show 06db4c6:<path>`; adapt to pieces, keep their tests):

| File                                                | What we take                                                                                     | What we drop                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `apps/server/src/orchestration/slots.ts` (29 lines) | The concurrency slots, as is                                                                     | —                                                                              |
| `apps/server/src/orchestration/group.ts`            | `prepareCopies`, `copyFor`, `finishCopy`, `removeCopy`, the run-a-group loop                     | Lane and span handling, carried steps                                          |
| `apps/server/src/orchestration/merge.ts`            | `mergeCopies`: commit each copy, merge in order, pin result refs                                 | Plan-step order (we merge in `dependsOn` topological order, ties by piece key) |
| `apps/server/src/orchestration/group-landing.ts`    | `sharedBase`, `attributeShared`, `copyFiles`, `landGroup`                                        | Lane naming                                                                    |
| `apps/server/src/projects/shared-tree.ts`           | All of it (section 3)                                                                            | —                                                                              |
| `apps/server/src/orchestration/placement.ts`        | `sharedTreeBlocker` and its manifest, lockfile and generated-file patterns; `WorktreeNeed` names | Lane inputs, `hardBlock` over step text (ownership replaces it)                |
| `apps/server/src/orchestration/step-files.ts`       | `sameFile` for path comparison                                                                   | Parsing files out of step prose                                                |

Not restored: chains, lanes, `parallel.ts`, `parallel-choice.ts`, `lane-choice.ts`, `spans.ts`, work orders, the plan session, the Architect and the watchdog. The piece list is structured data, so the text parsing those files did is not needed.

**Mechanics.**

1. **Base.** Before the first worktree piece, the main tree (uncommitted and untracked files included) is committed through a temporary index as the group base (`groupBase`), as round 4 did. The orchestration snapshot predates it, so Revert still undoes the whole story.
2. **Copy per piece.** `git worktree add -B spark/<task>/<name> <root>/.spark/worktrees/<runId> <base>`, dependency prep started at once, the copy is the Builder's only root. The approval gate runs unchanged inside it (paths relative to the copy, titles end "· Rivet's copy"). Ownership is enforced in copies too: it keeps the merge clean and the piece in scope.
3. **Land.** When the piece's scoped checks pass in its copy, the copy is committed to its branch and merged into the main tree at once (not at the end of the group), in dependency order: `tryMerge(main committed on base, piece result)`, then `applyTree`. Dependents that were waiting become ready and branch from the new main.
4. **Merge main into running copies.** When a piece lands and a running copy depends on it through a contract, or owns files that import the landed files, the coordinator merges main into that copy at the Builder's next turn boundary (commit the copy, `tryMerge` main into it, apply in the copy) and sends the notice "main merged: Tack's tags API landed; re-run your scoped checks" (section 6). This is the session's "merge main" steer, done by code.
5. **Conflicts.** A conflicting merge first goes to the integrator in the main tree with both sides' diffs (the round-4 "Ask a Builder to reconcile" option, now automatic at Automatic and Full auto → PR, one attempt, then a second with the first attempt's check failures). Only when the integrator cannot resolve it: the existing `merge_conflict` card at Review each step and Automatic, and a stop with the conflict in the report at Full auto → PR (Full auto → PR never keeps a guess).
6. **Migration renumbering.** Pieces that add migrations are placed in worktrees (a migrations folder is a blocker). At landing, `coordinator/migrations.ts` looks for numbered migration files (`NNNN_name.sql`, also `NNNN-name.*` and timestamp prefixes) that collide with a number already on main, renames the landed file to the next free number, and records the rename in the report. Only plain numbered folders are renumbered by code; anything that references migration names elsewhere goes to the integrator. Builders are told never to run migrations against a shared database; the coordinator's full checks run them against the test database.
7. **Cleanup.** Every copy and branch is removed after it lands, on Stop, on failure, and at the end of the orchestration; `cleanOrphanedCopies` still sweeps after a crash. Result commits stay under `refs/spark-outpost/builders/<runId>` for the Changes view.

## 5. Multi-provider

**Assignment** (`coordinator/assign.ts`). Pieces default to the chat's provider. With two or more Builder-capable providers connected (Claude, Codex, Z.ai), parallel pieces are spread when:

- the other provider is healthy: no rate limit (`isRateLimited` in `agents/acp/errors.ts`) or auth error in the last 10 minutes, and no open `providerIssues` (`persistence/provider-health.ts`);
- it has budget: under the provider's share of the task budget and any daily cap (the queued cost-cap feature), and its account concurrency allows another session;
- its model passes the Builder floor, and complex pieces can get its top tier;
- the piece does not run in a mode that skips the approval gate in the shared tree (row 2 of the placement sends it to a worktree).

The rule: pieces in order stay on one provider (warm caches, one session style); parallel pieces alternate by size, the largest piece on the chat's provider. A pinned model pins every piece. Jev's per-piece provider pick is not used: round 10 found Jev's provider choice a coin flip; it is recorded as `autoWouldUse` only.

**The Critic from another provider.** `criticProvider` in `routing.ts` gains the piece providers as input: the first connected provider that built no piece; else the provider that built the smallest share of the diff; with one provider, the same provider one tier up labelled "same provider, no cross-model review", as today. The Critic gets the request, the agreed plan, the piece list (goals, contracts, acceptance) as its contract, the integrated diff and the full check results. Over the 24 KB diff cap it reviews piece by piece in one resumed session (`${taskId}:critic`), each piece's diff with its own contract, then gives one combined verdict.

**Fallback when a provider fails** (rate-limited, down, out of budget, signed out):

| When                            | What happens                                                                                                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before the piece's first edit   | The piece is reassigned to the next eligible provider, fresh Builder, same brief; the report says "moved from Codex (rate limited)"                                                                                                     |
| After edits, in a worktree      | The copy is kept; a Builder on the next provider starts in the same copy with a handoff (piece contract, files changed so far with the diff stat, last scoped check output, open acceptance items); the handoff follows ROUTING_PLAN §9 |
| After edits, in the shared tree | Same handoff in the main tree; ownership unchanged                                                                                                                                                                                      |
| No other provider is eligible   | The piece waits (other pieces keep going); after 10 minutes, or when it is the only piece left, the retry card (Review each step, Automatic) or stop-and-report (Full auto → PR)                                                        |
| The Critic's provider fails     | The next Critic candidate; with none left, "No Critic: …" in the report and on the keep card                                                                                                                                            |

Provider failures are not Builder failures: they do not use the one-tier-up retry budget.

## 6. Steering running Builders

ACP has no way to add text to a turn that is running (round 9 found this with the watchdog nudges). Two delivery paths:

- **At the next turn boundary** (default). A piece note is stored and sent as the first block of the Builder's next turn in the same session (`resumeKey`), headed "## Note from the coordinator". Every piece Builder's turn is kept short by its prompt ("stop after each acceptance item that passes its scoped check"), so boundaries come every few minutes.
- **Now** (urgent notes only). `session/cancel`, wait for the turn to wind down (edits stay in the tree), then resume the same session with the note first. Before phase C6 we check whether the pinned claude-agent-acp and codex-acp versions accept a `session/prompt` while one is running; if either queues it, that adapter uses the queue instead of cancel and resume.

**Note kinds** (`piece_notes`, section 8):

| Kind                | From                                                                                                               | Delivery                                                 | Effect                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `merge_main`        | Code, after a landing (section 4)                                                                                  | Boundary                                                 | Main merged into the copy first, then the note                                                                                                                                         |
| `contract_changed`  | Code, when a landed piece's diff touches a symbol named in another piece's contract, or the integrator changes one | Boundary; now when the dependent's owned files import it | New contract version for dependents                                                                                                                                                    |
| `requirement_added` | The user, or the coordinator after a Critic finding outside a fix round                                            | Boundary                                                 | Piece contract version bumped; acceptance item appended; ownership unchanged unless re-approved                                                                                        |
| `skip`              | The user ("skip the export piece")                                                                                 | Now                                                      | Cancel; the piece's changes are reverted from its snapshot (shared tree) or its copy is dropped (worktree); dependents are re-validated and skipped too unless the user says otherwise |
| `stop`              | The user or a budget                                                                                               | Now                                                      | Cancel and report, as Stop today                                                                                                                                                       |
| `reassign`          | Section 5, or the user ("do the tests with Codex")                                                                 | Now                                                      | Handoff to a new Builder                                                                                                                                                               |
| `steer`             | The user, free text for one piece                                                                                  | Boundary                                                 | Passed through as written                                                                                                                                                              |

**The user steering via chat.** While a coordinated task runs, a new chat message goes to the coordinator, not to a Builder. Intake's `continues_task` decides as today; within a running coordinated task the coordinator then classifies the message by rule first ("skip", "stop", "also", "use <provider> for", a piece title or Builder name) and by one Jev Choice when the rule does not match (`steer_target`: a piece key, all pieces, a question, or a new task). A question is answered in place by the chat's agent (Scout) with the piece table as context; a steer becomes a note; anything that changes ownership or adds a piece becomes a new piece-list version (section 8) and, at Review each step, a card before it applies. The reply confirms what was queued ("Queued for Rivet: … (next turn)").

## 7. UI

Follows the mockup (`docs/design/mockup/spark-outpost-mockup.html`) and the existing crew components in `apps/web/src/crew/`.

- **Crew turn.** A coordinator block at the top of the turn (face from the coordinator's name pool, provider colour from its session) with a **piece board** (`crew/PieceBoard.tsx`, new): one row per piece with its title, the Builder's name and blob, a placement badge ("in order", "shared tree · owns 4 files", "Rivet's copy", "read-only"), provider and model, status (waiting on P1, running, landed, skipped, failed), the scoped check, and cost. Rows fold when landed. Below it, the Builders' own blocks as today; parallel Builders show side by side as the round-4 "Working in parallel" group did (`crew-projection.ts` gains `pieceKey` and `placement` per member). The integrator and the Critic follow the board.
- **Agent TV** (`AgentTv.tsx`, `tv-scene.ts`, `tv-layout.ts`). The coordinator takes the centre; Jev moves beside it as its advisor. Builders sit around it with their piece title, placement badge and a thread to the pieces they wait on; a landing animates the Builder's thread into the centre. The list view (`TvList.tsx`) groups by piece.
- **Work panel.** The Tasks tab lists pieces under the plan items they cover, with "used by plan v3". The Changes tab shows per-piece diffs (attribution, section 3) and "Rivet's copy" for worktree pieces, as the `copy` field already allows. The Plan tab shows the piece list version and whether it is approved for the current plan version.
- **Cards only per the harness autonomy.**

| Card                                                                                                     | Review each step                                             | Automatic                                                              | Full auto → PR              |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------- |
| Piece list ("Build in 4 pieces, 2 at once in worktrees": Build it, Build in order instead, Revise, Stop) | When placement is shared tree or worktrees, or pieces are 5+ | Only when the story is destructive (the risky card carries the pieces) | Never; in the PR body       |
| Ownership violation                                                                                      | Yes                                                          | No (moved or reverted, said in the report)                             | No                          |
| Merge conflict                                                                                           | After the integrator fails twice                             | After the integrator fails twice                                       | Never; stops and reports    |
| Changed piece list (new piece, new ownership)                                                            | Yes                                                          | Only when it adds a destructive piece                                  | Never                       |
| Provider unavailable, nothing to move to                                                                 | Retry card                                                   | Retry card                                                             | Stop and report             |
| Keep, fix, revert                                                                                        | As today                                                     | As today                                                               | As today, then the draft PR |

Edit and command approvals inside pieces follow the agent's mode exactly as for one Builder. With 3 Builders in an asking mode (Manual, Ask every time) that can mean 3 approval streams at once; the approval cards are grouped under each Builder's block and the sidebar badge counts them together.

## 8. Data model

The plan document stays immutable per version; pieces change status while they run, so they get their own table instead of a JSON column on `plan_documents`.

**Migration `NNNN_coordinator.sql`** (the next free number at merge, `0055` today, as every slice does):

```sql
CREATE TABLE piece_lists (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  orchestration_run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  plan_document_id uuid REFERENCES plan_documents (id) ON DELETE SET NULL,
  plan_version integer,
  pieces_hash text NOT NULL,
  placement text NOT NULL CHECK (placement IN ('in_order', 'shared', 'worktree')),
  placement_reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed', 'approved', 'superseded', 'rejected')),
  approval_id uuid REFERENCES approvals (id) ON DELETE SET NULL,
  approved_by text CHECK (approved_by IN ('user', 'level')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, version)
);

CREATE TABLE task_pieces (
  id uuid PRIMARY KEY,
  piece_list_id uuid NOT NULL REFERENCES piece_lists (id) ON DELETE CASCADE,
  key text NOT NULL,
  title text NOT NULL,
  goal text NOT NULL,
  owns text[] NOT NULL,
  reads text[] NOT NULL DEFAULT '{}',
  depends_on text[] NOT NULL DEFAULT '{}',
  contract text,
  contract_version integer NOT NULL DEFAULT 1,
  acceptance text[] NOT NULL DEFAULT '{}',
  checks text[] NOT NULL DEFAULT '{}',
  research boolean NOT NULL DEFAULT false,
  size_estimate integer NOT NULL,
  placement text NOT NULL CHECK (placement IN ('in_order', 'shared', 'worktree', 'read_only')),
  provider text,
  model text,
  builder_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  worktree_id uuid REFERENCES run_worktrees (id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'running', 'landed', 'skipped', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  fix_turns integer NOT NULL DEFAULT 0,
  files_changed text[] NOT NULL DEFAULT '{}',
  violations jsonb NOT NULL DEFAULT '[]',
  landed_at timestamptz,
  note text,
  UNIQUE (piece_list_id, key)
);

CREATE TABLE piece_notes (
  id uuid PRIMARY KEY,
  piece_id uuid NOT NULL REFERENCES task_pieces (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('merge_main', 'contract_changed', 'requirement_added',
                                     'skip', 'stop', 'reassign', 'steer')),
  body text NOT NULL,
  source text NOT NULL CHECK (source IN ('user', 'coordinator')),
  urgent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  delivered_run_id uuid REFERENCES runs (id) ON DELETE SET NULL
);
```

Plus, in the same migration:

- `runs.role` CHECK adds `coordinator` and `integrator` (and `run_advice.role` the same).
- `approvals` checkpoint kinds add `pieces` and `ownership` (`merge_conflict` exists).
- `projects.builder_env jsonb` (the per-Builder check environment, section 3) and `projects.stable_checkout boolean NOT NULL DEFAULT false` ("keep my checkout stable while agents work": worktrees for any parallel piece).
- `run_advice` purpose `parallel` is reused for placement decisions; no constraint change.

**Contracts.** `packages/contracts/src/pieces.ts` (new): the zod schema for the coordinator's `pieces` block (what the model writes), `taskPieceSchema` and `pieceListSchema` (what the API returns), the placement and status enums, and `pieceBoard()` for the UI. `crewMemberSchema` in `orchestration.ts` gains `pieceKey` and `placement` (optional, like `copy`). The `pieces` block the coordinator writes:

```json
{
  "pieces": [
    {
      "key": "P1",
      "title": "Tags table and repository",
      "goal": "Store tags per project",
      "owns": [
        "apps/server/migrations/NEXT_project_tags.sql",
        "apps/server/src/persistence/tags.ts"
      ],
      "reads": ["apps/server/src/persistence/projects.ts"],
      "dependsOn": [],
      "contract": "listTags(db, projectId): Promise<string[]>; setTags(db, projectId, tags)",
      "acceptance": ["Tags are normalised to lower case and deduplicated"],
      "checks": ["pnpm vitest run apps/server/src/persistence/tags.test.ts"],
      "size": "M"
    }
  ],
  "integration": "Wire the tags route into api/app.ts after P2 lands"
}
```

**Validation** (`coordinator/pieces-validate.ts`, pure): keys unique; at most 8 pieces; `dependsOn` names existing keys and is acyclic (Kahn's algorithm, the cycle named in the error); owned paths inside the project roots, not secret, not inside `.git`; two pieces that own the same path (after glob expansion) must be ordered by `dependsOn`, and then both run in order; a piece reading a file another piece owns depends on it unless the file is named only in a contract; each piece's size estimate is at most the smallest Builder budget among its candidates, else one re-prompt to split it; scoped checks are narrowed project checks or allowlisted; the list covers the agreed plan's open items. The approval hash is SHA-256 over the canonical JSON of keys, owns, dependsOn, contracts and acceptance.

**Persistence.** `apps/server/src/persistence/pieces.ts` (new): insert a list version, supersede, approve bound to `plan_document_id` and `plan_version`, piece status transitions guarded by the current status (a stale event cannot move a landed piece), notes with delivery marking. Recovery: a crash leaves running pieces `failed` with "outcome unknown", their copies are swept, landed pieces stay landed, and nothing is replayed, as for runs today.

**API.** `GET /api/tasks/:id/pieces` (the current list version with pieces and notes), `POST /api/tasks/:id/pieces/:key/notes` (a user steer), and a live `ACTIVITY_SNAPSHOT` with `activityType` `pieces` on the orchestration stream after every piece transition.

## 9. Phased implementation and the story benchmark

Each phase is one branch, merged with its tests green, behind `OrchestratorDeps.coordinator` (`off`, `shadow`, `in_order`, `parallel`) so a phase can ship dark. The live stack keeps `off` until phase C8's benchmark decides.

| Phase                                | Builds                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Tests                                                                                                                                                                                                                               | Ships as                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **C0 · Contracts and pure logic**    | `contracts/pieces.ts`; `coordinator/pieces-validate.ts`, `size.ts`, `placement.ts` (the ladder, blockers restored from `06db4c6`), `policy.ts` thresholds `coord-1`                                                                                                                                                                                                                                                                                     | Unit: validation (cycles, overlaps, coverage, secrets), size estimate, every ladder row and fallback                                                                                                                                | No behaviour change                            |
| **C1 · Shadow**                      | For every Do task, record whether the coordinator would engage and what placement it would pick, from the agreed plan and the scan (no coordinator turn) as a `parallel` row; `pnpm coord:shadow` prints the distribution                                                                                                                                                                                                                               | DB: rows on plan builds and stories; none on one-liners                                                                                                                                                                             | Shadow data from real use and the dev-day runs |
| **C2 · Pieces in order**             | The coordinator migration; persistence; the coordinator turn and its `pieces` block; one Builder per piece in `dependsOn` order in the main tree, each fresh with the piece contract and the landed pieces' diff stat; scoped checks per piece; the integrator; full checks once; Critic once; the report; the 75% context handoff (fresh Builder on the same piece when `contextUsed / contextSize ≥ 0.75` at a turn boundary); piece board, read-only | Unit: schedule, report. DB with the fake ACP roles (`#pieces`, `#handoff`): a 3-piece story lands in order, a failing scoped check gets its fix turns, a handoff at 75%, full checks fail then the integrator fixes, crash recovery | `in_order`                                     |
| **C3 · Ownership and git guards**    | `DecideOptions.owned`, `BUILDER_GIT_REASON`, Claude deny rules, command write-target checks, the post-turn ownership diff check, the violation card, per-Builder environment and the check lock                                                                                                                                                                                                                                                         | Unit: `decide()` refusals per target and level. DB: a Builder writing outside its piece is refused; a shell write is caught and reverted; `git stash` is refused                                                                    | Applies to C2 already                          |
| **C4 · Shared-tree parallel**        | `Slots` restored; the ready-set scheduler with 3 slots; `shared-tree.ts` and `attributeShared` restored; landing per piece; piece-list card; parallel Builder blocks                                                                                                                                                                                                                                                                                    | DB: two independent pieces run at once and land with per-piece Changes; a dependent waits; Stop mid-group; budget continue                                                                                                          | `parallel` behind a project flag               |
| **C5 · Worktree parallel**           | `group.ts` and `merge.ts` pieces restored; land-as-you-go merges in dependency order; merge main into running copies; integrator-first conflicts then the card; migration renumbering; dependency prep per copy                                                                                                                                                                                                                                         | DB: two worktree pieces merge clean; a conflict resolved by the integrator; one it cannot resolve shows the card; colliding migration numbers renumbered; orphan sweep after a crash                                                | `parallel`                                     |
| **C6 · Multi-provider and fallback** | `assign.ts`; `criticProvider` with piece providers; provider fallback with handoff; the per-piece Critic over 24 KB                                                                                                                                                                                                                                                                                                                                     | DB with the fake agent's rate-limit role (`#ratelimit`): a Codex piece is moved to Claude before and after its first edit                                                                                                           | `parallel`                                     |
| **C7 · Steering**                    | `piece_notes`; boundary and urgent delivery; the adapter check for queued prompts; merge-main and contract-changed notices from code; chat steering with `steer_target`                                                                                                                                                                                                                                                                                 | DB: skip reverts a piece and its dependents; an added requirement reaches the next turn; merge main before the notice                                                                                                               | `parallel`                                     |
| **C8 · UI and the benchmark**        | Agent TV coordinator scene, piece board states, work panel tabs; the story benchmark below                                                                                                                                                                                                                                                                                                                                                              | Browser: the piece board, the piece-list card by keyboard, a conflict card, the phone layout                                                                                                                                        | The decision in section 10                     |

**The story benchmark** (`scripts/e2e-live/story/`, reusing the dev-day driver, scorer and its GitHub and secret isolation). One story sized so that one Builder can still finish it (so arm a is a fair baseline) but a coordinator would split it: in the `workbench` fixture, **"Project budgets"**: a migration adding `project_budgets`, a repository and API (`GET/PUT /api/projects/:id/budget`, 400 and 404 cases), a budget bar in the project page, an over-budget badge in the analytics list, a CSV column in the existing export, and tests for each. About 5 pieces, 2–3 of them independent once the table and API land. Hidden tests: 10, across the layers.

| Arm                                            | Setup                                                                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **a · one Builder**                            | Coordinator `off`: today's lean harness, one Sonnet Builder                                                                                        |
| **a2 · pieces in order**                       | Coordinator `in_order`: same story, split, one Builder at a time                                                                                   |
| **b · shared-tree subagents across providers** | `parallel`, placement forced to shared tree, Claude and Codex both connected, pieces alternated                                                    |
| **c · worktrees**                              | `parallel`, placement forced to worktrees, Claude only                                                                                             |
| **d · provider fallback**                      | Arm b with Codex returning 429 from its second tool call on (a proxy in front of codex-acp, or the fake agent's `#ratelimit` role for the dry run) |
| **direct Claude**                              | The dev-day direct arm, as the outside baseline                                                                                                    |

Each arm runs **n = 3** at Automatic (Full auto → PR for one extra run per arm to check the PR body), with a $25 cap. Scoring, in this order:

1. **Pass rate**: hidden tests 10/10 and the project checks green; plus scope (no file outside the story's areas).
2. **Cost per pass including the developer's time**: agent spend plus $100/h at 1 minute per intervention, plus each failure's repair estimate (30 minutes for a story), as in the dev-day reports.
3. **Interventions**: cards answered, steers needed, conflicts shown.
4. **Wall time**, first message to the final reply.

Also recorded per run: coordinator-turn cost as a share of the total, ownership violations, integrator turns, merge conflicts and who resolved them, renumbered migrations, handoffs, provider moves (arm d), per-Builder peak context, and whether the Critic found anything the full checks missed. Arm d passes when the story still passes, the moved piece keeps its earlier edits, and no piece runs twice.

## 10. Risks, and when we turn it off

**Risks.**

| Risk                                                                                                            | Mitigation                                                                                                                                          | Watch in the benchmark                              |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Parallel is not faster** (round 10: 57 s shared, 60 s worktrees, and direct Claude did the same work in 31 s) | Parallel only for 2+ independent large pieces with a 35% critical-path saving; the default stays one Builder                                        | Wall time b and c against a and a2                  |
| The coordinator turn repeats the Architect's cost (34–77% of a planned turn)                                    | Engage only past the size thresholds; resume the plan's warm session; code, not a model, does placement, integration and the report                 | Coordinator share of cost; alarm above 20%          |
| Cold Builders re-read what the coordinator read                                                                 | Piece contracts name the reads; Builders in order get the landed pieces' diff stat; the 75% handoff sends a summary, not the transcript             | Reads per Builder, total input tokens against arm a |
| Ownership too tight: Builders stop to ask for a file they need                                                  | The refusal message names the owner; the coordinator can grant the file by a new list version; files no piece owns move into the piece at Automatic | Violations and re-plans per story                   |
| Shell writes bypass the gate                                                                                    | Diff check after every turn, revert or move, two strikes to in order                                                                                | Violations caught by the diff check vs the gate     |
| Scoped checks miss what full checks find, late                                                                  | Full checks once, integrator repair rounds, the Critic                                                                                              | Integrator repair rounds per story                  |
| Concurrent checks collide on a database or ports                                                                | Per-Builder environment, else the check lock                                                                                                        | Check failures that pass on rerun                   |
| More agents means more rate limits, correlated per provider                                                     | Spread across providers; fallback with handoff; at most 3 Builders                                                                                  | 429s per run                                        |
| More cards at Review each step (3 approval streams)                                                             | Parallel placement shows its piece list first so the user can choose "in order"; grouped approvals                                                  | Interventions and clicks against a                  |
| Anchoring: a detailed piece contract lowers pass rates (SWE-bench Science: 36% → 32% with expert rationale)     | Contracts hold interfaces and acceptance, not implementation advice                                                                                 | Pass rate a2 against a                              |
| Stale contracts after a steer                                                                                   | Contract versions and `contract_changed` notices                                                                                                    | Rework after a notice                               |

**Evidence that turns it off.** After the C8 benchmark (n = 3 per arm), and again after 50 real coordinated tasks:

- **Parallel placement (b, c) stays off** unless it is at least **30% faster** in wall time than the better of a and a2, at **the same or higher pass rate**, with cost per pass including the developer's time at most **1.2×** arm a. Round 10 is the prior: if parallel buys less than that on a story sized for it, it will buy nothing on the everyday tasks where it was already not faster.
- **Pieces in order (a2) stays off** unless it passes at least as often as one Builder on the story and fixes something one Builder gets wrong (a handoff that saved a run near its context limit, or a piece-level check that caught what the Builder missed). If one Builder passes the story 3/3 at lower cost, the coordinator engages only on explicit request.
- **Shared tree loses to worktrees** (keep only worktrees) if ownership violations average more than 1 per story or any run needed a manual repair after a neighbour's edit.
- **Worktrees lose** (keep only shared tree) if merge conflicts show in more than 20% of worktree runs or dependency prep adds more than a minute per piece.
- **Multi-provider assignment stays off** (all pieces on the chat's provider, the Critic still cross-provider) if arm b does not beat the same placement on one provider, or its failures cluster on one provider's pieces.
- **Anything that lowers the pass rate** against arm a is reverted, whatever it saves. A failed story costs the developer about 30 minutes; no saving in agent spend covers that (the Builder-floor reasoning in ROUTING_PLAN §4).

What we would remove if it is turned off: the placement rows 2 and 3, the restored group and merge code, and `piece_notes`; the ownership guards and the git-op refusals stay, since they protect one Builder too.
