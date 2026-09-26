# Harness plan

Proposed on September 25, 2026 and updated the same day into a build plan, now that Jev is connectable as an advisor. The user's Decisions, at the end, are binding. `HARNESS_ONE_PAGE.md` is inspiration, not a spec. Jev itself is described in [JEV.md](JEV.md), the ACP details in [ACP_AGENTS.md](ACP_AGENTS.md) and [ACP_COVERAGE.md](ACP_COVERAGE.md).

## Build order for the next 2 weeks

1. **M1 is done**: several read-only repos per chat, the context bar, and Claude and Codex reading (Codex through a patched true read-only mode).
2. **S1a: Audit recording is done** (September 26): raw ACP protocol log, full agent stderr, redaction, hash chain, and tokens and cost per agent run labelled reported or estimated. See [ACP_AGENTS.md](ACP_AGENTS.md#audit-recording) for what is recorded.
3. **S1b: Tasks, plans, and the live task list is built, not yet user-accepted** (September 26): `0014_tasks.sql`, versioned plans per task with "used by", PR link capture, the harness-built task list, `GET /api/tasks/:id`, and the work panel with the task card. See [Tasks](#tasks) for what landed and what is left.
4. **S1c: Audit view is built, not yet user-accepted** (September 26): Summary by model, role, provider, and run, a per-turn timeline with approval waits, filterable paged logs with a per-run chain badge, JSONL and CSV export (`export.csv`), estimate labels (~) wherever cost appears, the Crew tab, and OpenAI list prices for the Codex models.
5. **S2: Jev intake and model routing, recorded only, is built** (September 26): one batched intake call per run next to the cold start, the fixed-rules comparison, confidence gates, `0017_advice.sql`, the advice line, and Jev's cost lines. The Auto option now shows in the model picker whenever Jev is connected. See [S2 status](#s2-status-september-26-2026).
6. **M2: Do with approvals (F-13)**, with the four involvement levels. Landed September 26 for Claude; Codex Do is off (see M2 status).
7. **Orchestrator: Jev-driven subagents is built, not yet user-accepted** (September 26): every top-level run is an orchestration that acts on Jev's gated intake, routes a model per subagent, runs Scout, Architect, Builders and Critic as child runs, and asks at the level's checkpoints. `0019_orchestration.sql`. See [Orchestrator status](#orchestrator-status-september-26-2026).
8. **Crew names and parallel agents are built, not yet user-accepted** (September 26): friendly names per role (Bolt · Builder · Sonnet 5 · medium), parallel Scouts for research steps, and parallel Builders in git worktrees with plan-order merges and a `merge_conflict` checkpoint. This pulls M7's worktrees forward. `0021_parallel.sql`. See [M7 status](#m7-status-september-26-2026).

The UI for S1 follows the mockup (`docs/design/mockup/spark-outpost-mockup.html`): work panel, task card, crew, Agent TV, and audit view. Migration numbers are provisional: each slice takes the next free number when it lands.

## Principles

A simple harness lets people see, control, and trust what the agent does, without learning how the harness is built.

- **See it.** Every tool call is a step with a record of what happened: the diff, the command, its output, and its exit code.
- **Approve it.** Risky actions pause the run on a card. The backend enforces the decision, not the model.
- **Stop it.** Stop always works, even while an approval is waiting.
- **Survive restarts.** Postgres is the source of truth. After a crash the run shows `outcome_unknown`, and nothing is replayed automatically.
- **Trust the result.** The "what changed" card comes from the harness's own records and `git`, not from what the agent says it did.
- **Keep the output.** Plans, changes, checks, and reviews are durable run artifacts that can be opened, compared, and exported after the run, even after a restart.
- **Choose per chat.** Provider, model, effort, and mode live in `conversations.overrides`. Advice can suggest; only the user and the fixed rules decide.

**Why not always planner, executor, then reviewer.** Running all three on every run means three cold starts (8–10 s each for Claude), about three times the tokens, and a stuck run whenever a review fails, even for "what does this function do?". Both agents already plan natively and stream ACP `plan` updates, so the harness records the agent's own plan as an artifact instead of running a planner. It picks a **mode**, not a pipeline.

## What the user sees

Six visible concepts. Everything else stays out of sight until it matters.

| Concept               | Where                          | What it does                                                                                 |
| --------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| **Mode picker**       | Composer                       | Chat, Ask, Ask before edits, Auto-accept edits. The only control over what the agent may do  |
| **Approval card**     | Thread, in the live turn       | Allow, Allow for this run, Deny; for commands also "Always allow in this project"            |
| **Plan checklist**    | Turn card, and the Plan panel  | The agent's plan with pending, in-progress, and done states. History and export in the panel |
| **What-changed card** | Turn footer after a Do run     | Files changed from our records and `git`, next to the agent's claim. Revert after a crash    |
| **Review button**     | What-changed card              | "Review by Claude · high effort". A review is labelled an AI review, never verification      |
| **Cost line**         | Turn footer, chat and Settings | Tokens and cost per run, per chat, and per provider, with Jev's cost as its own small item   |

**Hidden:** jobs and leases, run events, ACP sessions, config option IDs, artifact version numbers (behind "History"), Jev's probabilities (on hover only), snapshot refs, budgets until one runs out, and the allowlist (in project settings, filled from the approval card).

## Modes

The mode comes from the user's picker and fixed rules. No model picks it, and Jev never changes it.

| Mode                  | When                                       | Agent setup                                                                                                                                | Approvals                                                                       |
| --------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **Chat**              | No linked folder                           | Today's lockdown: an empty temp folder and no tools                                                                                        | None; every request is declined                                                 |
| **Ask**               | A folder is linked and the picker says Ask | Claude: `cwd` is the primary repo, file reads only. Codex: no folder access on codex-acp 1.13.1, whose `read-only` mode is workspace-write | Writes and commands are declined, with a hint to switch to Do                   |
| **Do**                | A folder is linked and the picker says Do  | Claude: `default` mode, Read/Glob/Grep/Edit/Write/Bash, `ask` rules for Bash/Edit/Write. Codex: unavailable (see M2 status)                | The involvement level decides (see Involvement levels); some actions always ask |
| **Review** (optional) | The user clicks "Review changes"           | A fresh Ask run with the diff attached                                                                                                     | None                                                                            |

- The picker is stored in `overrides[provider].permission` and defaults to the provider's default permission (Decision 1). The run records it as `runs.mode`.
- "Skip all checks" and "Full access" stay hidden until worktree isolation (M7).

## Run lifecycle

Run statuses: `queued → running ⇄ awaiting_approval → succeeded | failed | cancelled | outcome_unknown`.

- **Approvals** (M2). The permission handler calls a pure `decide(mode, request, runRules, allowlist)` that returns allow, reject, or ask. Ask inserts a pending `approvals` row, emits `approval_requested`, and waits on `NOTIFY approvals` with a 1 s poll as backup. The ACP request stays open and the lease keeps renewing. `POST /api/approvals/:id/decision {optionId}` only succeeds while the row is `pending`; a changed `payload_hash` needs a new approval. Stop answers `cancelled`. After 30 minutes the harness answers reject-once, marks it `expired`, and fails the run with "Approval timed out".
- **Recovery.** A crashed run becomes `outcome_unknown`, and its pending approvals expire. If it was waiting, the message says the action never ran. The plan and every other artifact written so far stay readable. Nothing is replayed.
- **Budgets** (M4). A pure `budgets.ts`: 15 minutes of active time (approval waits don't count), 60 tool calls, and an optional cost cap from Settings (Decision 4). A spent budget sends `session/cancel` and ends with `RUN_ERROR` `budget_exceeded`, naming the limit.
- **Concurrency** (M4). 2 jobs at a time by default, at most 3. One Do run per project, checked when the job is claimed. Ask and Chat runs run in parallel.

## Run artifacts

One model for everything a run leaves behind that a person wants to open again: the plan, what changed, check results, the review, and advice.

### Storage

`0010_run_artifacts.sql`:

```sql
CREATE TABLE run_artifacts (
  run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('plan', 'changes', 'check', 'review', 'advice')),
  version integer NOT NULL CHECK (version > 0),
  body jsonb NOT NULL,
  source_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, kind, version)
);
ALTER TABLE runs ADD COLUMN mode text;
```

- **Append-only versions.** Each write adds the next version for `(run_id, kind)`. The latest version is the current artifact; earlier ones are its history.
- **Why a table and not only run events.** Run events are fenced by the worker's lease, so nothing can be appended once the run ends. A review, a check the user runs later, or advice that arrives late must still attach to the run. The table also makes "latest plan for each run in this chat" a single query.
- **Live updates.** While the worker holds the lease, an artifact is written in the same transaction as an AG-UI `ACTIVITY_SNAPSHOT` event (`activityType` is the kind, `messageId` is `artifact:<kind>`, `content` is `{ version, body }`, `replace: true`). This goes through `appendRunEvent` with a new `artifact` option, like `assistantMessage` today. Writes after the run are plain inserts with `pg_notify('run_artifacts', runId)`; the web refetches the run on that notice once F-10's status stream exists, and on focus until then.
- **Bodies** are validated by zod schemas in `packages/contracts/src/artifacts.ts`, both on write and on read. Each body is capped at 256 KB; longer diffs and outputs are cut with a `truncated` flag.

| Kind      | Written by and when                                      | Body                                                                                                                        |
| --------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `plan`    | Worker, on each ACP `plan` update that differs (S1)      | `entries: [{ content, priority, status }]`                                                                                  |
| `advice`  | Worker, before the prompt and after a Do run (S2, M5)    | `purpose` (route or review), `rules` and `jev` advice, `jevError`, `applied`, `latencyMs`, `usage { inputTokens, costUsd }` |
| `changes` | Worker, when a Do run ends; recovery, after a crash (M3) | `base` (git ref or recorded writes), `files [{ path, change, additions, deletions }]`, `patch`, `agentClaim`                |
| `check`   | Worker or the check endpoint (M4)                        | `command`, `exitCode`, `durationMs`, `outputTail` (8 KB), `approvalId`                                                      |
| `review`  | The review run, attached to the reviewed run (M5)        | `reviewer { provider, model, effort }`, `changesVersion`, `verdict` (looks good, concerns, unclear), `text`                 |

### API

- `GET /api/conversations/:id` adds a small `artifacts` summary per run, for example `plan: { version, done, total }`, so the thread renders without extra requests.
- `GET /api/runs/:id/artifacts` returns the latest version of each kind.
- `GET /api/runs/:id/artifacts/:kind` returns every version, oldest first, for the history view.
- `GET /api/runs/:id/artifacts/:kind.md` returns Markdown with `Content-Disposition: attachment`. The Markdown for each kind comes from one pure `artifactMarkdown(kind, versions)` in contracts, shared by the server and "Copy as Markdown".

### Plans in detail

- **Capture.** `session-updates.ts` stops turning plan entries into work-log steps. It emits a new provider output `{ kind: 'plan', entries }` with content, priority, and status. The worker drops an update identical to the latest version, then writes a new version. After 200 versions in one run, the latest version is overwritten instead, so a looping agent can't grow the table without bound.
- **Replacement.** ACP plan updates replace the whole plan, and entries have no IDs. The history compares versions by entry text in a pure `planChanges(previous, next)`: added, removed, and status changed.
- **In the thread.** A Plan card sits at the top of the turn, above the work log: a checklist with ○ pending, a spinner for in progress, ✓ done, and a small "high" tag (low priority is dimmed). The header reads "Plan · 3 of 5 done". While the run works the card updates live; afterwards it is collapsed to its header. If the run was cancelled or crashed, unfinished entries show as "not finished".
- **The Plan panel.** "Plan" in the turn footer opens a side panel that works for any run, live or finished. It shows the checklist, a "History" toggle with a timeline ("10:02 added Run tests · 10:04 Fix divider done · 10:05 removed Update docs"), and "Copy as Markdown" and "Download .md". The same panel shows Changes, Checks, and Review as tabs when they exist.
- **Links.** The panel state is in the URL: `/c/:conversationId?run=:runId&panel=plan`. It's a local link to reopen or bookmark, not a public share.
- **Claude's plan mode.** An exit-plan-mode request (`kind: switch_mode`) is an approval (M2). Its plan text shows on the approval card and isn't a plan artifact, because it isn't an ACP `plan` update.

## Where Jev fits

Jev is an advisor, never an executor or an authority. It answers two questions: which provider, model, and effort, and whether a finished Do run should be reviewed and by whom. `ruleAdvisor` answers the same questions with fixed rules and is always the fallback.

### Phases

| Phase         | Milestone | Jev is asked                                     | What changes for the user                                                            |
| ------------- | --------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **1. Record** | S2        | Route, before every run                          | A muted line "Jev suggested Codex · high effort". Dispatch keeps the chat's settings |
| **2. Review** | M5        | Review, after a Do run that changed files        | The review button's reviewer, and whether it's offered at all                        |
| **3. Route**  | M8        | Route, before the run, when "Let Jev pick" is on | The run uses Jev's provider, model, and effort                                       |

Phase 3 ships only after phase 1 data shows Jev beats the rules. A pure report compares recorded advice with outcomes (failed, cancelled, the user switched provider on the next message, review concerns).

### When it's called

1. **Before a run (phases 1 and 3).** In `execute-run.ts`, after the job is claimed and before the provider starts, when Jev is connected.
   - Phase 1 doesn't wait. The call runs next to the provider's 4–10 s cold start. If advice arrives while the run works, it is written with an `ACTIVITY_SNAPSHOT`. If it arrives after the run ends, it is inserted without an event. After 10 s it is recorded as timed out.
   - Phase 3 waits at most 2.5 s, then uses the chat's settings and records `applied: 'rules'` with the reason.
2. **After a Do run (phase 2).** After the `changes` artifact is written and before `RUN_FINISHED`, with the change counts and whether a check ran. It waits at most 3 s. On timeout or error it uses `reviewSuggested` and the other connected provider (Decision 3). Jev's review answer is used only when its probability is at least 0.6 or at most 0.4; in between, the rules decide.
3. **Never** during a run, for approvals, for Chat runs in phase 2, or when only one provider is connected and there is nothing to route (phase 1 still records effort advice).

### Data sent, minimised

- **Sent:** the task text (the new message only, capped at 8,000 characters), the mode, whether a folder is linked, the connected providers with their model and effort IDs, and for review only the counts: files changed, files deleted, and whether a check ran.
- **Attached text** on the new message is sent (capped at 8,000 characters, without names) only for the injection question, since S2.
- **Never sent:** history, image attachments, file names, paths, diffs, command output, project names, and credentials.
- A unit test pins the exact `state` keys, so any new field is a visible change.

### Cost, storage, and display

- **Cost.** `askSystemOne` already receives `usage.input_tokens`; the `Advice` type gains `usage`. Cost is estimated at $0.042 per million input tokens from the catalog and stored as `usage.costUsd`. `GET /api/usage/summary` and the chat's `usageTotals` gain an `advisors` line (calls, tokens, estimated cost), so Settings shows Jev next to the providers.
- **Storage.** Every call writes an `advice` artifact: both the rules' and Jev's answers, the error if any, which one was applied, and the latency. This replaces the `runs.advice` column proposed in JEV.md.
- **Display.** One muted line under the turn header: "Jev suggested Codex · high effort · review by Claude". When it differs from what ran: "Jev suggested Codex · high effort (ran Claude · medium)". Hover or focus shows the reason, confidence, latency, and cost. On failure: "Jev unavailable · used the fixed rules". With Jev disconnected, nothing is shown.

### Jev can never grant permissions

- `Advice` has no mode, permission, or approval field, and `decide()` takes no advice argument.
- A routed run keeps the mode the user picked. If Jev routes to another provider, the run uses the same mode class (Ask or Do), never a looser one, even if that provider's picker is looser.
- Advice cannot start a Do run, skip an approval, extend a budget, or mark work verified. Phase 2 offers a review; it doesn't start one (see Open questions).
- Tests assert that every possible Jev answer leaves `runs.mode`, the approval decisions, and the budgets unchanged.

## Project folders and safety

- **Linking** (M1, `0009_projects.sql`, `0010_conversation_projects.sql`): `projects (id, workspace_id, name, root_path)` with symlinks resolved, and an ordered `conversation_projects` list per chat whose first entry is the primary repo. The server refuses `/`, `$HOME`, and anything that isn't an existing directory.
- **File access** goes through `fs-handlers.ts` and the pure `projects/path-policy.ts`: absolute paths only, inside the root after symlinks are resolved, reads capped at 1 MB, writes (M2) create missing folders and record hashes before and after plus a diff.
- **Secret files are refused** for reads and writes, each shown as a step: the list in `projects/secret-files.ts` (`.env*` except `.env.example`, SSH key names, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `.npmrc`, `.netrc`, `.pgpass`, `.pypirc`, `.git-credentials`, credential files), writes under `.git/`, and `.sparkignore` entries.
- **Approval buttons.** "Allow", "Allow for this run" and "Always allow in this project" all answer the agent with `allow_once`; the harness keeps the run rule and the allowlist itself, so the agent never switches to a looser mode and every later action still gets a receipt. "Deny" answers `reject_once`. `reject_always` isn't shown.
- **Commands.** Claude's shell tool goes through `request_permission`, and the card says the command isn't sandboxed. Codex's sandboxed commands and edits inside its writable roots run without a permission request under `on-request`; only escalations reach us (see [agent adapters](AGENT_ADAPTERS.md)). A command on the project's allowlist runs without asking at the Balanced and Hands-off levels (Decision 2). Codex Do is unavailable: see M2 status.
- **Sandbox.** No `sandbox-exec` (Decision 5). Tools that reach the disk without our handlers are listed as known gaps.
- **Worktrees** (M7): an opt-in git worktree per task under `.spark/worktrees/<runId>`, merged or discarded by the user. Required before "Full access".

## Milestones

Each slice ships on its own and leaves the app working. "Fake" means `AGENT_RUNTIME=fake` for browser tests and `test/fake-acp-agent.ts` for provider tests; both gain the triggers each slice needs, like today's `#fail`.

### M1: Ask in a folder (in progress)

- **Landed or in flight:** `0009_projects.sql`, the project API and folder dialog, `cwd` at the root, the read handler with the path policy, @-mentions as attachments with `source_path`.
- **Remaining after the current work:** read-only modes for both agents in a linked folder; recording the mode on the run (`runs.mode`, in `0010` if M1 doesn't add it); the known-gaps list for Claude's built-in tools; the live test.
- **Done when:** a live run summarises a README and is refused `../x`, and both are visible as steps.

### S1: Run artifacts and the plan checklist

- **Scope:** `run_artifacts`, the `artifact` option on `appendRunEvent`, the `plan` provider output with priority and in-progress, the Plan card, the Plan panel with history, Markdown export, and URL state.
- **Migration:** `0010_run_artifacts.sql`.
- **API:** the three artifact routes and the conversation summary.
- **UI:** `PlanCard`, `ArtifactPanel` (tabs appear as later slices add kinds), "Plan" in the turn footer.
- **Tests:** unit for `planChanges`, `artifactMarkdown`, and the mapping from ACP plans (priority, in progress, replacement, dedupe); db for version numbering, the 200 cap, cascade on delete, and writes after the lease is gone; browser with a fake `#plan` trigger that sends three updates: the live checklist, then reload and restart the API, the plan is still there, history shows three versions, export downloads; optional live with Codex asked for a multi-step answer.
- **Done when:** the plan of any run opens after a restart and matches the last update the agent sent.

### S2: Jev records advice

- **Scope:** read the key from the keychain, call the Jev and rule advisors before the prompt without waiting, write `advice` artifacts, add usage and cost to `Advice`, the advice line, and the advisors line in usage.
- **Migration:** `0017_advice.sql` (`run_advice`, `conversations.model_routing`).
- **API:** conversation summary gains `advice`; `GET /api/usage/summary` gains `advisors`.
- **Tests:** unit for the minimised `state`, cost estimation, and every Jev failure (401, 429, 529, timeout, bad shape) recording `jevError`; db for late advice after the run ended; browser with a fake advisor (`ADVISOR_RUNTIME=fake`): the line shows, a failing advisor shows "Jev unavailable", disconnected shows nothing; optional live with a real key, one call.
- **Done when:** runs with Jev connected record advice, and no run is slower or behaves differently than with Jev off.

#### S2 status (September 26, 2026)

- **Built:** the intake questions (intent, complexity, risk, injection over attached text only, depth, and provider, model, and effort per connected provider) in one call, validated against what was offered; `ruleAdvisor` every run; `gate(answer, risk, level)`; `run_advice` in `0017_advice.sql` (advice is per run because `run_artifacts` is keyed per task and chat runs have none) plus `conversations.model_routing`; the `ACTIVITY_SNAPSHOT` while the run is live; the muted "Jev suggested …" line with its tooltip; and Jev as its own line in the chat's context popover, the work panel Cost tab, and Settings → Usage. The model picker offers Auto whenever Jev is connected; the orchestrator acts on it. Details are in [JEV.md](JEV.md#s2-intake-and-model-routing-recorded-only-implemented-september-26-2026).
- **Data sent** now includes attached text (capped at 8,000 characters, no names) so the injection question has something to judge. Tool output is not sent: before a run there is none from this run, and earlier output can hold repo contents.
- **Gates:** act at 0.9, or 0.75 for read-only work; fall back below 0.5; in between, ask below the level's clarify line (hands-on 0.75, balanced 0.6, hands-off 0.5), otherwise act; full auto lets the rules decide in between. Intake (intent and depth) and the model pick (provider and model) are gated separately.
- **Tests:** unit for questions, parsing and rejection, every gate threshold, cost, and the rules comparison; db for the live snapshot, late advice after the run ended, the timeout, rules only when Jev is disconnected, a missing key, and Auto stored without changing the run; browser with a stubbed Jev: the line and tooltip show, and nothing shows when Jev is disconnected; live, eight real calls.
- **For the orchestrator:** read `run_advice.body.gate.decision` and `routeGate.decision`. Depth is Jev's weakest intake answer, and the provider choice is close to a coin flip, so routing across providers should stay on the chat's provider until the data says otherwise.

Live results (`jev-1.13.0`, balanced; the rules would have run Claude · Sonnet 5 · medium every time):

| Sample                     | Mode | Intent   | Complexity (0–3) | Risk        | Injection | Depth                   | Model pick                 | Intake conf. | Model-pick conf. | Would                     | Latency | Input tokens | Cost       |
| -------------------------- | ---- | -------- | ---------------- | ----------- | --------- | ----------------------- | -------------------------- | ------------ | ---------------- | ------------------------- | ------- | ------------ | ---------- |
| question                   | ask  | explain  | 0.91             | read-only   | —         | direct                  | codex · 6 Luna · low       | 0.82         | 0.07             | use Jev; model fallback   | 355 ms  | 1467         | $0.0000616 |
| typo fix                   | do   | fix      | 0.01             | edits       | —         | execute                 | claude · Haiku 4.5 · low   | 0.98         | 0.17             | use Jev; model fallback   | 182 ms  | 1472         | $0.0000618 |
| multi-file refactor        | do   | refactor | 2.15             | multi-file  | —         | plan → execute          | claude · Sonnet 5 · medium | 0.40         | 0.44             | fall back; model fallback | 180 ms  | 1476         | $0.0000620 |
| destructive migration      | do   | refactor | 1.63             | destructive | —         | plan → execute → review | codex · 6 Sol · medium     | 0.44         | 0.21             | fall back; model fallback | 152 ms  | 1472         | $0.0000618 |
| injection in attached file | do   | chat     | 0.86             | edits       | 0.99      | direct                  | claude · Haiku 4.5 · low   | 0.70         | 0.40             | use Jev; model fallback   | 229 ms  | 1599         | $0.0000672 |
| chit-chat                  | chat | chat     | 0.04             | read-only   | —         | direct                  | claude · Haiku 4.5 · low   | 1.00         | 0.86             | use Jev; model act        | 198 ms  | 1458         | $0.0000612 |
| feature                    | do   | feature  | 1.69             | edits       | —         | plan → execute          | codex · 6 Sol · medium     | 0.39         | 0.09             | fall back; model fallback | 242 ms  | 1471         | $0.0000618 |
| review                     | ask  | review   | 1.79             | read-only   | —         | direct                  | claude · Opus 5.5 · medium | 0.42         | 0.35             | fall back; model fallback | 231 ms  | 1463         | $0.0000614 |

### M2: Do with approvals (F-13)

- **Scope:** the `approvals` table, `awaiting_approval`, the approval card, `fs/write_text_file` with diffs, commands that always ask unless allowlisted, the allowlist and "Always allow in this project", Stop while waiting, the timeout, recovery that expires approvals, and elicitation forms (M2b).
- **Migration:** `0011_approvals.sql`: `approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options, status, decision_option_id, scope, decided_at, created_at)`, the new run status, and `projects.command_allowlist text[]`.
- **API:** `POST /api/approvals/:id/decision`, `PATCH /api/projects/:id` for the allowlist; the conversation detail includes pending approvals.
- **Tests:** unit for `decide()` across modes and the allowlist; db for decision races, `payload_hash` changes, timeout, and crash while waiting; browser with the fake: allow, deny, Stop, reload while waiting; live: an edit and `ls`.
- **Done when:** no write or command runs in Do without an approval or an allowlist match, and Stop works while a card is open.

#### M2 status (September 26, 2026)

- **Landed:** migration `0015_approvals.sql` (the `approvals` table with receipts for every decision, `awaiting_approval`, `runs.mode`, `runs.level`, the snapshot columns and `reverted_at`, `projects.command_allowlist`, `provider_connections.level`, `run_file_backups`). Existing permission values became `ask`, so nothing was widened.
- **Picker.** Chat when no folder is linked, otherwise Ask or Do, plus the level for Do. Stored per chat in `overrides[provider].permission` and `.level`, with defaults per provider connection in Settings.
- **Decisions.** The pure `approvals/decide.ts` takes the level, the request, the run rules and the allowlist. Always asks, at every level: `git push`, deleting outside the repo (`rm`, `find -delete`, delete tool calls), secret files (`projects/secret-files.ts` and `.sparkignore`, in paths and command words), and changing files outside the repo. Refused: reads outside the project and edits inside `.git`. An allowlist entry covers the same command with more arguments, never a chained one.
- **Waiting.** `workflow/approval-gate.ts` inserts the pending row, emits `approval_requested` (an AG-UI `CUSTOM` event) with the run moving to `awaiting_approval`, and waits on `NOTIFY approvals` with a 1 s poll. `POST /api/approvals/:id/decision {optionId, scope, payloadHash}` only succeeds while pending and when the hash matches. Stop answers `cancelled`; 30 minutes answers `reject_once`, marks it `expired` and fails the run with "Approval timed out"; recovery expires pending approvals and says the action never ran.
- **Snapshot and revert.** A Do run starts with a git snapshot built in a temporary index (`read-tree HEAD`, `add -A -- .`, `commit-tree`, kept under `refs/spark-outpost/runs/<runId>`), which never touches the user's index or working tree. Outside git, the harness copies each file before an approved edit. `GET /api/runs/:id/changes` and `POST /api/runs/:id/revert` restore only files changed since the run started (`git restore --worktree` from the snapshot, added files removed), once.
- **Known gaps.** Git snapshots skip ignored files, so changes to them aren't reverted. Outside git, changes made by commands aren't backed up. Plan approval, clarification and retry checkpoints are stubs; only the level is stored.
- **Codex finding (live, codex-acp 1.13.1 with our patch).** In `agent` mode (workspace-write, auto-reviewer) Codex ran `ls` and created a file with no `session/request_permission` at all. In the patched `read-only` mode it ran `ls` without asking and only the write escalated to a permission request. No mode asks before commands, so no involvement level can be enforced, and Codex Do ships as unavailable with that reason in the picker, in Settings and from the API. Revisit when codex-acp offers a user-reviewed mode that asks for every command, or execpolicy `prompt` rules are verified through the adapter.
- **Live Claude test** (`test/approvals.live.test.ts`, Balanced): the edit asked and was allowed once, `ls` asked and was allowed for this run, `git push origin HEAD` asked with "Pushing always asks" and was denied (nothing reached the remote), and the revert restored `README.md` with a clean `git status`.

#### Orchestrator status (September 26, 2026)

The orchestrator acts on S2's intake instead of only recording it. It lives in `apps/server/src/orchestration/`; the pure parts (`transitions.ts`, `depth.ts`, `checkpoint-policy.ts`, `budget.ts`, `routing.ts`, `tiers.ts`, `context.ts`, `jev-questions.ts`, `review.ts`) have their own unit tests.

- **Model.** `0019_orchestration.sql` adds `runs.parent_run_id`, `role` (scout, architect, builder, critic), `step_index`, `attempt`, `agent_label`, the harness-built `prompt` and the `route` record; `runs.user_message_id` is unique for top-level runs only. `orchestrations` holds the phase, depth and its source, risk, routing, retries and budgets. `approvals` gains the checkpoint kinds `clarify`, `plan`, `retry`, `accept`, `budget` and a `note`. `run_advice` keeps every Jev decision (`intake`, `route`, `transition`) with its gate, child run, role and step, and gains the `not_asked` status for decisions that reused an earlier call.
- **Runs.** The worker hands every claimed run to `orchestrate()`. A direct answer (Scout) and the first Builder of an `execute` run run in place on the top-level run, so a simple turn is unchanged; everything else is a child run with its own ACP session, work log, usage and protocol log, leased by the orchestrator (never queued) and run in the same worker. Children never write chat messages; the orchestration writes the final reply (the last Builder's reply and the AI review line).
- **Intake and depth.** The intake call now waits for at most 3 s. Jev's depth is used only when the intake gate acts; `ask` shows the Clarify card (Do only) with Jev's top depth options, "Let the rules decide" and Stop; otherwise the rules decide from the mode and the risk (Jev's risk counts when its own confidence is at least 0.5): Chat and Ask are direct, edits execute, multi-file plans first, destructive plans and reviews. Ask and Chat never go deeper than direct.
- **Routing.** On Auto, the Scout and first Builder use the intake's model and effort for the chat's provider; planned Builders and the Critic come from one batched routing call after the plan; each pick is gated. Pinned chats use the pinned model for Scout and Builders and record "Auto would have used …". The Architect gets the top tier (Opus) at high effort unless pinned. The Critic runs on the other connected provider (Codex when the chat is Claude), in Ask mode. Builders stay on the chat's provider, which is Claude because Codex Do is unavailable. Escalation moves one tier (Haiku → Sonnet → Opus), then raises effort.
- **Subagents.** The Architect runs read-only with Claude's task tools (`TodoWrite`, `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`), which claude-agent-acp turns into ACP `plan` updates, so S1b stores its plan as versions; a numbered list in its reply is the fallback. Plan steps are batched into at most 4 Builder steps and run through M2's approval gate; since the [tuning](#harness-tuning-september-26-2026), consecutive steps outside a parallel group are carried by one Builder. The Critic ends with a verdict line; the verdict, findings and reviewer are stored as a `review` artifact labelled an AI review.
- **Context** is assembled by the harness (`context.ts`): the Architect gets the request, the last 6 turns and the repo names; a Builder gets the request, the plan, its step, the files the step names, and a diff summary of earlier steps; the Critic gets the request, the plan, the changed files and the diff (24 KB cap) and the check results (none yet). Unit tests pin the text.
- **Transitions.** After each Builder and the Critic, one Jev call answers status, quality (0–4) and next, offering only possible next steps; the gate decides whether Jev's answer or the rules apply. Retries go one tier up, at most 2, then the retry card asks you; `blocked` and `needs you` ask too.
- **Checkpoints** use M2's approvals table, card and `POST /api/approvals/:id/decision` (`note` carries the plan edit or the fix request). Clarify and plan approval follow the involvement table; retry and escalation ask always at Hands-on and below 0.9 at Balanced; keep, fix or revert asks at Hands-on and Balanced when files changed ("revert" restores the orchestration's snapshot, "fix" runs another Builder with your note); a spent budget always asks. Stop works everywhere and cancels the active child.
- **Budgets** per orchestration: 15 minutes of active time (approval waits excluded), 60 tool calls, and `ORCHESTRATION_COST_CAP_USD` when set. A spent budget stops the active agent and asks; Stop ends it as `budget_exceeded`, Continue grants another full allowance and restarts the step.
- **Tasks and audit.** The orchestration opens or joins the task before planning; children share it, so plan versions, PR capture and the task list span them. The task list names each child by its label and step and lists pending and user-decided approvals by title. The audit summary labels runs by role, adds `byRole`, and gives per-orchestration totals by role and model.
- **Recovery.** A crash leaves the orchestration and its active child `outcome_unknown` through the existing lease recovery; pending checkpoints expire; nothing is replayed. "What changed" and revert work on the orchestration run, whose snapshot predates every Builder.
- **API.** `GET /api/runs/:id/orchestration`, `orchestrations` in the conversation detail (top-level `runs` only; children are in each orchestration's `crew`), and a live `ACTIVITY_SNAPSHOT` (`activityType` `orchestration`) on the orchestration's stream after every step.
- **Tests.** Unit: transitions, depth fallback, the routing gate, context assembly, repair and escalation limits, level checkpoints, budgets, tiers, questions, cards and totals. DB with the fake ACP agent acting as Architect, Builder and Critic: all 5 scenarios of the harness page at all 4 levels (path, checkpoints, records, totals), plus retry limits, retry confirmation, plan edits, revert from the card, the time budget, pinned routing, rules without Jev, Stop mid-Builder, and crash recovery while building and while a checkpoint waits.
- **Live** (`test/orchestration.live.test.ts`, temp repos, the user's Claude, Codex and Jev accounts, Auto):
  - **(a) Trivial fix, Balanced.** Jev: execute at 0.98. One in-place Builder · Haiku 4.5 · low, no planner; asked the edit and Keep; succeeded in 10.7 s for $0.0185 (reported, 41,359 tokens) plus two Jev calls ($0.00009).
  - **(b) Multi-file change, Balanced.** Jev: plan → execute → review at 0.86. Architect · Opus 5.5 · high wrote plan v4 through the task tools ($0.137, 25.5 s); plan approval asked; 4 Builders · Sonnet 5 · medium (Jev's per-step picks were gated back to the chat's model at 0.37–0.57); Critic · Codex 6 Sol · high said looks good ($0.0023, estimated). Four edits, two commands and Keep were asked. 97.9 s, $0.332 plus seven Jev calls ($0.0003). An earlier run, before the Architect had the task tools, fell back to the numbered steps in its reply and ran Haiku Builders that Jev picked at 0.68–0.94 ($0.147).
  - **(c) Stop mid-Builder, Hands-off.** Architect · Opus 5.5 · high ($0.053, 16.1 s), then Stop 5.4 s into Builder · Haiku 4.5 · low: the Builder and the orchestration ended cancelled 0.74 s after Stop, 23.4 s in total.
- **Web integration (September 26).** The contract now carries what the UI had worked around: each crew member's `name` (a friendly name such as "Rivet" since the crew names landed), the clarify free-text option `CHECKPOINT_OPTION.answer` (a note option; the API refuses it without a note, and the engine appends the answer to the request as "The user clarified: …" and lets the rules pick the depth), `role` and `runId` on task list items (the work panel shows the server's list; a plan entry gives way to the Builder run working on it), `jevTokens` in the totals, `needsInput` while any approval of the latest turn or its children is pending, and every child approval mirrored as `approval_requested` and `approval_decided` on the orchestration's stream. Finished agent blocks replay their own stream, so a Critic's verdict and each Builder's reply stay readable.
- **Browser tests against the real engine.** `tests/browser/crew.spec.ts` and `crew-checkpoints.spec.ts` drive the real orchestrator through the fake ACP agent's roles with a scripted Jev stub (`tests/browser/jev-stub.ts`: `#crew` plans and reviews multi-file work, `#unsure` asks to clarify, `#retry` asks for a retry). They cover Balanced (plan, three Builders with edit approvals, the Critic, Keep; the crew blocks, headers, the sidebar and rail badges, the work panel Tasks and Crew tabs, and Agent TV while it runs), Full auto (only `git push` asks), clarify by option and in your own words, retry, Stop mid-Builder, an edited plan then Stop, Fix from the keep card, and the phone layout. The route-mocked orchestration tests and their invented crew data are gone.
- **Live in the app** (September 26, dev stack at localhost:5173, a temp repo, Do · Balanced · Auto, checkpoints answered through the UI): a rename across two files and the README ran as one in-place Builder · Sonnet 5 · medium (Jev: execute at 0.79), asked three edits and Keep, 56.4K tokens for $0.097 plus two Jev calls ($0.0001). A "plan it first" request to move code into a new module ran Architect · Opus 5.5 · high (plan v4, $0.145, 23 s), plan approval, Builder · Sonnet 5 · medium then Builders 2 to 4 · Haiku 4.5 (Jev's picks), four edits and Keep: 239K tokens, $0.225 plus six Jev calls ($0.0003), 81 s. Jev chose plan → execute, so no Critic ran. The crew blocks, Agent TV and the work panel matched the run throughout.
- **Known gaps.** Checks (M4) don't run yet, so the Critic always reads "No checks ran". Builders run in parallel only when the plan tags independent steps (see [M7 status](#m7-status-september-26-2026)). The retry card after 2 retries shows at every level, including Full auto. A Builder's file-write approval is titled with the absolute path ("Write /…/notes.txt") in the work panel. A stopped agent reads "Failed" in its header. The orchestration's final reply (the last Builder's reply and the AI review line) is stored for history but not shown again in the crew turn.

### M3: Tool-call records and "what changed"

- **Scope:** AG-UI `TOOL_CALL_*` events; tool-call content, diffs, locations, kind, name, title changes, and `rawOutput` exit codes; thought text as AG-UI `REASONING_*` events (capped at 32 KB per run); the start-of-run snapshot; the `changes` artifact; the what-changed card; after a crash, "Revert to before this run" and "Keep changes" (Decision 6).
- **Migration:** `0012_tool_calls.sql`: `tool_calls (run_id, tool_call_id, kind, title, status, approval_id, paths, diff, output_tail, exit_code)`, the diff capped at 64 KB and output at 8 KB; `runs.snapshot_ref text`.
- **API:** `GET /api/runs/:id/tool-calls`; `POST /api/runs/:id/revert` (one confirmation, touches only files changed during the run).
- **Tests:** unit for diff capping and git status parsing; db for revert touching only run files, outside git as well; browser with the fake: diff steps, the card, a crash then revert; live: one edit shows in the card.
- **Done when:** the card matches `git diff` for the run and the agent's summary is labelled as its claim.

### M4: Budgets, concurrency, and checks

- **Scope:** `budgets.ts`, one Do run per project, the project's `check_command` run through the approval path, and the `check` artifact with a Checks tab.
- **Migration:** `0013_project_checks.sql`: `projects.check_command text`.
- **API:** `POST /api/runs/:id/checks` runs the check after the run.
- **Tests:** unit for budgets; db for the per-project claim; browser: a budget stop names its limit, a failing check shows its exit code; live: `pnpm test` as the check in a scratch repo.

### M5: Review, with Jev choosing the reviewer

- **Scope:** Jev phase 2, the review button with the chosen reviewer, the review run (an Ask run with the diff), and the `review` artifact attached to the reviewed run with `source_run_id`. The reviewer ends with "Verdict: looks good" or "Verdict: concerns"; anything else is "unclear".
- **Migration:** none.
- **Tests:** unit for the 0.4–0.6 band and the fallback; browser with the fake advisor and fake reviewer: button label, review tab, "AI review" label; live: a Claude review of a Codex change.
- **Done when:** a review never marks a run verified, and Jev's choice never starts a review by itself.

### M6: Context and warm sessions

- **Scope:** `session/resume` (or `session/load` when only `loadSession` is advertised), `session/close` and `session/delete` when advertised, the `/` command menu from `available_commands_update`, @-mentions as `resource_link`, and compaction once real chats outgrow the 36 KB budget.
- **Migration:** `0014_provider_sessions.sql`: `provider_sessions (conversation_id, provider, session_id, cwd, last_message_id, settings_hash)`.
- **Tests:** a resumed session receives only the new message; a settings change starts a fresh session; the fake advertises and withholds each capability.

#### M6 status (September 26, 2026)

Resumable sessions landed. The `/` menu, @-mentions, `session/delete` and compaction are still open.

- **What the adapters support.** claude-agent-acp 0.81.2 and codex-acp 1.13.1 (with our read-only patch) both advertise `loadSession`, `sessionCapabilities.resume` and `close`, and both resume a session in a **new agent process**: Claude reads the transcript Claude Code keeps under `~/.claude/projects` (`session/resume` recreates the SDK query with `resume: <id>`), and Codex calls `thread/resume` on its stored thread. So agent processes stay per run and there is no warm process pool; nothing extra stays in memory between turns. Claude's `closeSession` only knows sessions in its own process.
- **Storage.** `0026_provider_sessions.sql`: `provider_sessions (conversation_id, provider, agent_key, session_id, cwd, workdir, additional_dirs, settings_hash, last_message_id, last_reply_hash, reported_cost_usd, created_at, last_used_at, closed_at, close_reason)`, at most one open row per conversation and agent key. A chat turn's key is `chat:<mode>`; a child's is `key:<resumeKey>`.
- **When a turn resumes** (`decideResume` in `workflow/session-decision.ts`, pure): the latest row for the key is open, used within the idle time, its settings hash matches (provider, model, effort, run mode, planning tools, linked repos in order), its last turn finished, and, for chat turns, the message just before the new one is the reply it wrote with the same text (so a queued message or text appended by the orchestration, such as a Critic's verdict, forces a fresh start). The provider then also needs `resume` (preferred) or `loadSession` advertised and the same `cwd` and extra directories; otherwise, or if the resume call fails, it opens a new session with the history as before. The work log gets a quiet step: "Continued session" or "Fresh session (settings changed)" (also "chat changed since", "last turn did not finish", "idle", "started fresh", "chat archived", "repos changed", "couldn't resume"). An agent that can't resume at all gets no note.
- **What a resumed turn sends.** Only the new message and its attachments (plus the title request on untitled chats): no project note and no history. Chats without a project get a stable folder per conversation and key (`$TMPDIR/spark-outpost-sessions/<hash>`) instead of a new temp folder, so `cwd` matches on the next turn.
- **`session/load`.** Used only when `resume` isn't advertised. The SDK's update routing is attached after the load response, so replayed `user_message_chunk`, `agent_message_chunk` and tool updates never reach the mapper, and the audit tap drops `session/update` notifications while the load is pending, so they aren't stored or counted as tool calls.
- **Cost.** Claude's `usage_update` cost is cumulative over the session, so a resumed run records the reported cost minus the cost stored at the end of the previous turn (`reported_cost_usd`). Token counts on the prompt response are per turn for both agents.
- **Lifecycle.** At the end of each tracked turn the provider sends `session/close` (when advertised, 3 s cap) before stopping the process, so the adapter shuts down cleanly. A stored session is closed (a database state) when: the chat's provider, model, effort, permission, routing or repos change (`PATCH /api/conversations/:id/settings`, only when a value really changed); the chat is archived; the user picks **Start fresh** in the chat header's ⋯ menu (`POST /api/conversations/:id/fresh-session`); a turn fails or is stopped; it has been idle for `SESSION_IDLE_MINUTES` (default 30); or more than `SESSION_OPEN_LIMIT` (default 8) are open, least recently used first. The worker sweeps idle, archived and excess sessions on start and with every recovery pass, and removes a chat's session folder once no open session uses it and it has been idle; deleting a chat removes its folders.
- **Orchestration children: the `resumeKey` contract.** A child run resumes only when the orchestrator stores `route.resumeKey` on it (and optionally `route.followUp`). Use a key scoped to the task and the member, for example `${taskId}:builder:${name}`, and reuse it for that Builder's retries and fix follow-ups. The same rules apply (same provider, model, effort, mode and repos, same `cwd`, last turn finished), except that chat messages aren't checked. So a retry one tier up, or a Builder moved into a worktree copy, starts fresh by design. When the session continues, the agent receives `followUp` instead of the full `prompt` (it already has the plan, notes and earlier steps), so write `followUp` as the short instruction, such as the review findings to fix; without it the full prompt is sent again. Never give the same key to two runs at once. Children without a key behave exactly as before.
- **Measured** (`claude` Haiku 4.5, `codex` 6 Luna · low, turn 2 of a two-message chat without a project, time to first reply text including process start):

  | Agent  | Run   | Turn 2 fresh (history resent)                 | Turn 2 resumed                                      |
  | ------ | ----- | --------------------------------------------- | --------------------------------------------------- |
  | Claude | cold  | 7.9 s, 6,715 tokens written to cache, $0.0155 | 4.8 s, 6,669 read from cache + 187 written, $0.0013 |
  | Claude | warm  | 3.4 s, 6,715 read from cache, $0.0026         | 2.4 s, 6,669 read + 440 written, $0.0020            |
  | Codex  | first | 4.5 s, 11,227 uncached input + 4,864 cached   | 4.5 s, 970 uncached + 15,104 cached                 |
  | Codex  | again | 3.7 s, 11,227 uncached + 4,864 cached         | 3.2 s, 2,665 uncached + 15,104 cached               |

  In a two-message chat the history is small, so the win is mostly the cache: Claude reuses its cached transcript, and Codex's uncached input drops by 76–91%. The saving grows with the history that a fresh turn resends (up to the 36 KB budget), and a resumed agent also keeps its own tool results, which the text history never carried.

- **Tests.** Unit: `settingsHash` and `decideResume` (each reason, children skip the message check). Provider with the fake agent: `session/resume` sends only the new message and closes at the end, `session/load` replay is hidden from outputs and the audit, no capability, a missing session and a moved folder start fresh, the harness's reason is noted, and `followUp` replaces the prompt. DB: resume and "chat changed since", one open row per key, failure closes, children need a key, cumulative cost, LRU eviction, idle and archived sweeps with folder removal, only folders under the session root are removed, and the settings, repos, Start fresh, archive and delete routes. End to end through the worker: turn 2 continues, and after Start fresh turn 3 starts fresh. Browser: Start fresh from the ⋯ menu by keyboard.

### M7: Isolation and terminals

- **Scope:** worktrees per task, "Full access" inside them only, and the ACP `terminal` capability with byte limits, character-boundary truncation, and output that stays visible after release.

#### M7 status (September 26, 2026)

Worktrees landed first for parallel Builders. "Full access" inside a worktree and the `terminal` capability are still open.

- **When steps run in parallel.** The Architect is told to end its reply with a line such as `Parallel: 2, 3` naming consecutive steps that touch different files and need nothing from each other (groups separated by `;`), and to start read-only steps with `Research:`. A plan entry ending in a tag such as `[parallel A]` works too. `parallel.ts` keeps only consecutive groups, maps them through the batching of long plans, then splits a group wherever two steps name the same file, so the file list is a safety check rather than the trigger. The check is conservative: a step that names a file it only imports from counts as touching it. Plans without hints run exactly as before. Jev is not asked per step pair.
- **Read-only parallelism.** A `Research:` step runs as a Scout (Ask mode, in the main copy). Scouts in one group run together, a group may mix Scouts and Builders, and each Scout's reply is passed to later Builders as "Notes from Scouts". A Critic reviewing an earlier step while the next Builder works is not built: the Critic still reviews the whole diff once, because splitting the verdict needs a rule for combining two reviews.
- **Limits.** At most 3 members of one orchestration run at once (`ORCHESTRATION_PARALLEL_LIMIT`, `OrchestratorDeps.parallelLimit`) and at most `PARALLEL_AGENT_LIMIT` (default 6) across the worker. The worker's own `WORKER_CONCURRENCY` still counts orchestrations only.
- **Worktrees.** A group with two or more Builders in a git project first commits the main working tree (uncommitted and untracked files included, through a temporary index) as the group base. Each Builder gets `git worktree add -B spark/<task>/<name> <project>/.spark/worktrees/<runId> <base>`, and the worktree is its `cwd` and only project root. `.spark/` is added to `.git/info/exclude` once; `.gitignore` is never touched. `run_worktrees` records the path, branch, base and result commits, and when each copy was merged and removed. The row is written before `git worktree add`, so every copy on disk has a row.
- **Approvals.** M2's gate runs unchanged inside each copy, so paths are relative to the worktree, and titles end with "· Bolt's copy". A Builder in a copy cannot write to the main copy: it is outside its roots.
- **Merging.** When the group finishes, each successful Builder's copy is committed onto its branch (its result commit is also kept under `refs/spark-outpost/builders/<runId>`). Copies merge back in plan order: the main working tree is committed on top of the base, `git merge-tree --write-tree` merges it with the branch, and the difference is applied to the working tree with `git apply` (never the index, never a forced checkout). Each merged step is marked completed in the plan; the group's steps were marked in progress together.
- **Conflicts.** A conflicting merge asks a `merge_conflict` checkpoint titled like "Rivet and Tack both changed notes.txt.", with both sides' changes per file (base and each side's text, shown as Shiki diffs; unified diff text when a file is over 64 KB or binary). Keep Rivet's (the main copy's version of the conflicting files), Keep Tack's (the copy's version), Ask a Builder to reconcile (non-conflicting parts are applied, the main copy keeps the first version, and a new Builder runs in the main copy with both diffs in its prompt), or Stop.
- **Failures and Stop.** A failed member is not merged; its step is retried one tier up in the main copy through the normal retry rules. A stopped or budget-stopped group merges nothing, and Continue restarts the group's open steps. Worktrees and branches are removed after the merge, on Stop, on failure and at the end of every orchestration; the worker's recovery pass removes copies whose orchestration has ended (a crash leaves it `outcome_unknown`).
- **Outside git.** No worktrees: groups keep their Scouts, one Builder carries the Builder steps in order, and the orchestration records why in `parallelNote`.
- **Snapshot and revert.** The orchestration's snapshot is taken before the first copy, so "Revert to before this run" undoes every merged change. Just before a copy merges, its run's snapshot is re-pointed at the main copy's pre-merge commit, so the Changes view ends the previous run's diff there.
- **Budgets.** Tool calls and cost add up across all children. Active time is wall-clock time minus the union of approval waits, so two Builders waiting at once are counted once.
- **API and UI.** Crew members carry `parallelGroup` and `copy` (the branch); `GET /api/tasks/:id/changes` gives each copy's own branch diff with `name` and `copy`; task list items carry `name` and `group`. The thread shows a group as "Working in parallel: Rivet and Tack" with side-by-side mini headers (live members open, finished ones fold), the Tasks tab lists the group under "In parallel", and the Changes tab labels a copy "Rivet's copy".
- **Tests.** Unit: grouping from tags and files, members with and without worktrees, the parallel flow (group, merge, retry after a failed member, Stop at a conflict, budget continue, sequential fallback), crew ordering, overlapping waits, name pools, and real git copies (uncommitted files, disjoint merge without touching the index, conflict and keeping either side). DB with the fake ACP roles (`#parallel`, `#research`, `#collide`, `#slowstep N`): a 3-step plan where steps 2 and 3 merge cleanly and the plan ends all completed, parallel Scouts, each conflict option, Stop during a group, crash recovery removing orphans, and a non-git folder. Browser: the parallel group with its copy approvals and the Tasks tab, and the conflict card.
- **Live** (`test/orchestration-parallel.live.test.ts`, temp repos, Hands-off, Auto; the user's Claude and Jev): "create `dates.js`, then point `a.js` and `b.js` at it". Sketch · Architect · Opus 5.5 · high answered "Parallel: 2, 3"; Bolt · Builder · Haiku 4.5 · low made `dates.js`, then Rivet and Tack (Haiku 4.5 · low) ran together in `spark/<task>/rivet` and `…/tack`: 13.5 s of wall time against 24.3 s of Builder time, both merged cleanly, and no worktree or branch was left. The whole orchestration took 52.9 s for $0.1247 (reported) plus Jev $0.0001. The same request in a folder outside git, where Builders run one at a time, took 48.9 s for $0.1278: its Builders happened to be faster, so this run shows the overlap but not a shorter total. Its plan named `./dates.js` in both steps, so the file check had dropped the group anyway. In two earlier attempts the Architect wrote no hint (a tag inside its plan tool entries was ignored), which is why the hint moved to a reply line.
- **Known gaps.** Copies hold only what git tracks or would add: ignored files such as `node_modules` and `.env` are not in a worktree, so a Builder's commands that need them fail in its copy. Conflict paths assume the project is the repository root when shown. Nested projects inside a repository work but are less tested.

#### Harness tuning (September 26, 2026)

The first harness-vs-direct benchmark ([results](../benchmarks/harness-vs-direct-2026-09-26.md)) showed the harness at 1.9× the cost of one direct agent, almost all of it from planning and cold Builders on multi-file work. These rules came out of it; the re-run is in [the tuned results](../benchmarks/harness-vs-direct-2026-09-26-tuned.md).

- **A request that is already a plan skips the Architect.** When the depth would be `plan_execute`, the trusted risk is `multi-file`, the request names between 1 and 6 files (`namedFiles`, which now also sees a path at the end of a sentence), and Jev's intake confidence is at least 0.7, the depth becomes `execute` with one in-place Builder (`refineDepth` in `depth.ts`). The reason is stored as `depthNote` on the intake advice (an optional field of `adviceSummarySchema`) and shown in the intake decision's summary.
- **The Critic stays when Jev asks for review.** If the rules would plan without review but Jev's depth answer is `plan_execute_review` with a depth confidence of at least 0.5, the depth keeps the review. A review only reads, so this needs less confidence than acting on Jev's depth. Destructive risk still always reviews. This is checked before the skip, so a reviewed request keeps its Architect.
- **The Architect's tier follows the plan's size.** On Auto, a short plan gets the middle tier (Sonnet 5) at high effort: the request names 1 to 4 files, or Jev scores complexity moderate or lower (trusted at 0.5 confidence or more). Opus stays for vague requests (no named files), destructive risk, and complex ones. A pinned chat still uses its pinned model, and records what Auto would have used. The route decision's rule reads "short plan" or "top tier".
- **One Builder per run of sequential steps.** After planning, consecutive steps outside a parallel group go to one Builder in one ACP session (`carry` on the spawn, `spans.ts`). Its prompt lists every step, marks each "<- your step", and asks for a "Step N done." line after each one. `stepTicker` in `plan-progress.ts` watches the streamed text and ticks each step completed (and the next one in progress) as its marker arrives, so the plan still moves one step at a time. Anything not ticked is completed when the Builder is judged done. A failed or budget-stopped Builder is retried or resumed with only its unticked steps, one tier up for a retry. The planned route asks Jev once per span, with the span's steps as its work. Outside git every Builder step is carried by one Builder.
- **Builders get the Architect's notes.** The Architect is asked to end with "Notes for Builders:" (signatures, imports, short excerpts with paths). The Builder prompt gains "Notes from the Architect": the files the Architect read (from its `Read` tool calls) and that notes section (or its whole reply when there is none), capped at 4,000 characters (`ARCHITECT_NOTES_LIMIT`).
- **Parallel only when it pays.** A parallel group keeps its own Builders only if every Builder step in it names at least 2 files or the Architect lists it on a "Large: 2, 3" line (a step it expects to take more than about 20 seconds). Otherwise the group's steps are carried by one Builder. Research groups are unaffected.
- **Lower bar for cheaper picks.** The routing gate acts at 0.8 instead of 0.9 when Jev's pick is the same tier or cheaper than the fallback (same provider, model tier and effort no higher) and the risk is `edits`. Upgrades and `multi-file` or `destructive` risk keep 0.9; read-only keeps 0.75. `autoWouldUse` now records Jev's pick for every Builder and Critic route, on Auto as well as pinned, whether or not the gate acted, so a benchmark can measure the threshold.
- **Tests.** Unit: the gate thresholds, `refineDepth`, the Architect tier and complexity trust, the cheaper-pick gate and `autoWouldUse`, carried spans in the flow (retry and budget resume with only the open steps, rules after a carried span), the Large line and the worth-splitting filter, step markers, and the Builder prompt with carried steps and the Architect's notes. DB with the fake ACP roles: a request that names its files runs one Builder and records why, a less certain one plans with a Sonnet Architect whose notes reach the Builder, small tagged steps stay in one Builder, and the plan-progress, flow and level scenarios with one carrying Builder. Browser: the crew specs expect one Builder carrying the plan.

#### Harness round 3: Jev scope, Architect and parallelism (September 26, 2026)

Results: [round 3](../benchmarks/harness-vs-direct-2026-09-26-round3.md).

- **Scope question.** The intake batch asks one more choice, "How much of the codebase does `task` touch?", with the options one spot, one module, a few modules and across the codebase (`SCOPE_QUESTION` and `SCOPE_CRITERIA` in `intake-questions.ts`). The answer is stored as `scope` on the intake (an optional field of `jevIntakeSchema`) with its confidence in `confidences.scope`, and the dispatch tooltip shows it. A missing or unoffered answer leaves the scope unknown instead of failing the intake.
- **Simple and vague.** A request is simple when Jev puts its scope at one spot or one module and its complexity at moderate or lower, both at 0.5 confidence or more. It is vague when it names no files and its scope is not one spot (`architect-route.ts`).
- **Architect rule.** Destructive work gets the top tier. Simple work, vague or not, gets Sonnet 5 at high effort. When Jev answered the scope, an unsure answer (scope or complexity below 0.5) or a vague request gets the top tier. Otherwise the short-plan rule from the tuning round applies. The route decision's `rule` reads destructive, simple, unsure, vague, short plan or top tier.
- **One spot skips the Architect.** When the depth would be `plan_execute`, the risk is not destructive, and Jev puts the scope at one spot with both the scope confidence and the intake confidence at 0.7 or more, the depth becomes `execute` with one Builder, and the reason is stored as the intake's `depthNote`. Jev's review suggestion is checked first, so a reviewed request keeps its Architect.
- **Jev picks the Architect.** Before the Architect starts, one routing call asks Jev for its model and effort (slot `architect_0`). The pick acts through the same gate as the other routes: 0.9, or 0.8 when it is the same tier or cheaper than the rule's pick. Because the Architect only reads, the 0.8 bar applies at every risk except destructive (`readsOnly` in `gate.ts`). Below the gate the rule's pick runs. Destructive work always keeps the top tier. A pinned model always wins, and `autoWouldUse` records what Auto would have run. Every Architect route records Jev's pick (`autoWouldUse` on Auto), the rule's pick (`rulePick`), the rule and the gate.
- **Changed files, not mentioned files.** The parallel heuristics count only the files a step changes: the step's own `Files: a.ts, b.ts` list, which the Architect is now asked to end every step with, or else the files named in a clause with a change verb (create, add, edit, update, modify, move, rename, delete, remove, write, split, change, fix, implement, replace, extract, rewrite). A file named after "from", "using", "import", "see" and similar words is a read (`step-files.ts`). Two steps that only read the same file can run in parallel; a step that changes a file another step reads or changes cannot. The size rule counts changed files too.
- **Jev decides parallelism.** After the Architect's plan, in a git repo, one batched call asks a noul per adjacent step pair ("These steps can be done independently") and a noul per step ("This step is large (≥20s of work)"). A noul's confidence is `max(noul, 1 − noul)`; at 0.75 or more the answer overrides the Architect's `Parallel:` and `Large:` lines and the file heuristics for that pair or step, and below it they decide as before (`parallel-choice.ts`). Each plan records a `parallel` decision (`0025_parallel_decisions.sql`) with every candidate group, whether it ran in parallel, whether the heuristics would have, whether Jev decided it, and how often Jev's confident answers agreed with the heuristics.
- **Kept.** The 0.8 cheaper-pick threshold and `autoWouldUse` on every Builder and Critic route.
- **Keep-or-raise policy for Jev's Architect picks.** Compare Jev's picks with the rule's picks over the benchmark: when they pass as often at lower cost, keep the 0.8 and 0.9 gates; when the pass rate drops on runs where Jev's pick ran, raise the Architect gate. The round-3 conclusion is in the results.
- **Tests.** Unit: the scope question wording and parsing, simple and vague, the Architect rule and gate (cheaper, upgrade, below the gate, destructive, pinned), the reads-only gate option, the one-spot skip, changed and read files, `Files:` lines, the Jev parallel questions, noul certainty and overrides. DB with the fake Jev: the scope on the intake decision, the one-spot skip, Jev's Architect pick acting, falling back, destructive and pinned, and Jev keeping hinted steps sequential, splitting unhinted small steps, and deferring to the Architect's lines when unsure. Browser: the Jev stub answers the new questions neutrally (a few modules, an unsure Architect pick, unsure parallel nouls), so the crew specs keep their paths.

### M8: Let Jev pick (opt-in)

- **Scope:** a per-chat "Let Jev pick" option in the model picker, Jev phase 3, and the comparison report that justifies turning it on. Stored in `conversations.overrides.auto`.

**Deferred:** A2A, parallel specialist teams, automatic repair loops, project-wide "always allow" beyond commands, a warm process pool, elicitation URL mode, MCP servers for agents, and MCP-over-ACP.

## ACP completeness path

The ACP coverage work in flight (plan replacement, `finish(true)`, mode lock, notices, `protocolVersion`, `agentInfo`) is not repeated here.

| Gap (see ACP_COVERAGE.md)                                                            | Milestone    | Note                                                       |
| ------------------------------------------------------------------------------------ | ------------ | ---------------------------------------------------------- |
| Plan fidelity: `priority`, `in_progress`, full-plan replacement                      | S1           | Stored as artifacts instead of work-log steps              |
| `fs/write_text_file`, error `-32002`                                                 | M2           | Read handler landed in M1                                  |
| Permission option kinds, pending tool status, `cancelled` on Stop                    | M2           | Includes `switch_mode` (Claude's exit plan mode)           |
| Elicitation form mode, `elicitation/complete`                                        | M2b          | Same card component; never for secrets                     |
| Tool-call `content`, `diff`, `locations`, `kind`, `name`, `rawOutput`, title changes | M3           | Into `tool_calls` and the steps                            |
| `agent_thought_chunk` text                                                           | M3           | AG-UI `REASONING_*`, collapsed under "Thinking"            |
| Accept tool updates after `session/cancel`                                           | M3           | Needed for honest cancelled steps                          |
| `session/resume`, `session/load`, `close`, `delete`                                  | M6           | Only when advertised                                       |
| `available_commands_update`, `input.hint`                                            | M6           | Needs resumed sessions, so a `/` reaches the agent first   |
| `resource_link` for project files                                                    | M6           | With @-mentions                                            |
| `terminal/*` and embedded terminal content                                           | M7           | After worktrees                                            |
| `session/fork` for reviewers                                                         | M5, optional | Only if a forked reviewer beats a fresh Ask run            |
| `mcpServers`, MCP-over-ACP, URL elicitation                                          | Deferred     | `mcpServers` stays `[]` and Claude keeps `strictMcpConfig` |

## Evidence, kept distinct

- **Tool-call records** are what the agent did, as seen by our handlers and ACP.
- **What changed** is computed from `git` and our records, with the agent's summary beside it as its claim.
- **Checks** are exit codes of commands the user configured.
- **Reviews** are AI opinions, labelled as such.
- **Advice** is a suggestion with its source and confidence.

None of these is shown as verification. Only the user accepts the work.

## Tasks, crew, and audit (September 26, 2026)

The user asked for these on September 26. They build on the run artifacts above.

### Tasks

- A **task** is one piece of work in a chat. It can span several turns: "continue" or "also add a test" joins the open task. It owns the plan, the live task list, the agents that worked on it, links such as a PR, what changed, and the cost.
- **Storage:** `tasks (id, conversation_id, title, status, created_at, closed_at)`, plus `runs.task_id`.
- **Plans are versioned per task.**
  - An updated plan is a new version of the same plan.
  - A replaced plan supersedes the old one, which is kept and marked superseded.
  - Each run records `plan_version`, so "Builder worked from plan v2" stays true after v3 exists.
- **Links:** `task_links (task_id, kind, url, title, source, created_at)`. PR URLs are captured from ACP resource links, from tool output (`gh pr create`), or pasted by the user. PR status through `gh` comes later.
- **Live task list:** built by the harness from what it records, never by asking the agent. It shows plan entries plus the harness's own stages (understood, planned, each step, waiting for you, checks, review, PR). Each item names its agent, model, effort, tokens, and cost.
- **Built in S1b (`0014_tasks.sql`):**
  - **Task rule.** One pure `chooseTask(latest, didWork)` in `apps/server/src/tasks/rules.ts`. A new message joins the chat's open task when it is sent. A run without a task opens one on its first tool call, client action, or non-empty plan. Chit-chat stays taskless, and nothing closes a task yet.
  - **Artifacts are keyed per task**, not per run: `run_artifacts (task_id, kind, version, body, source_run_id, superseded_by, created_at)`, so a plan's versions span the task's runs. Only `plan` is written today. A plan write goes through `appendRunEvent` with the `artifact` option and an `ACTIVITY_SNAPSHOT` (`messageId` `artifact:plan`, `activityType` `plan`, `content { version, body }`), fenced by the lease. Opening a task and capturing a link add `task` and `link` snapshots so the web refetches.
  - **Plans.** `nextPlanWrite` drops identical updates and overwrites the latest version after 200. `planChanges(previous, next)` in contracts marks the previous version `superseded_by` when added plus removed entries are more than half of all entries; status changes alone are an update. `runs.plan_version` is the version a run started from or last wrote.
  - **Links.** `findPullRequests` normalises `github.com/<owner>/<repo>/pull/<n>` from tool text content, `resource_link`s, `rawOutput`, and the final reply text (only when the run has a task). `POST /api/tasks/:id/links` adds a user link; duplicates return the existing row.
  - **Task list.** `taskList(task, runs, events, plan)` and `taskSummary` in `packages/contracts/src/tasks.ts`: understood, made a plan, each plan entry, harness events, one item per run (follow-ups labelled with the request), and each PR. A run in `awaiting_approval` shows as waiting for you. The conversation detail carries `tasks` (list and summary); `GET /api/tasks/:id` adds `runs`, `planVersions` with `usedBy`, and `links`; `GET /api/tasks/:id/artifacts/plan.md` downloads `artifactMarkdown`.
  - **UI.** A task card under the task's latest turn and a work panel toggled from the chat header: the task list by default with waiting items pinned and done items folded, then Plan (version, used by, history, copy and download), Links (chips and Add link), and Cost tabs. It docks on wide screens, overlays below 1100 px, and is a bottom sheet on phones.
  - **Left:** per-approval waiting items and check or review stages once M2 and M4 write them as `events`; closing a task (PR merged, or Jev); a Plan card in the turn; a Changes tab; per-item tokens for plan steps; model and effort from S1a's `used_model` instead of the requested ones.

### Crew

- **Agents have roles:**
  - Jev: dispatcher
  - Scout: answers and reads
  - Architect: plans
  - Builder: edits
  - Critic: reviews
- **Each member has a friendly name**, drawn in order from its role's pool within a task (Scout: Pip, Wren, Skye; Architect: Sketch, Ada, Blue; Builder: Bolt, Rivet, Tack, Chip, Nut; Critic: Hawk, Owl, Lynx; a second round reads "Bolt 2"). A retry, a fix and an edited plan keep the name; the run stores it in `route.name`. Headers, the Crew tab and the Tasks tab show the name with the role as a subtitle.
- **Each has a blob:**
  - The face is seeded by the name.
  - The color comes from the provider: Claude warm, Codex blue, Jev magenta.
  - The expression follows the agent's state.
- **Labels read** "Bolt · Builder · Sonnet 5 · medium".
- **Agent TV** is an optional corner popout showing the crew working, with Jev in the center.
- **Model picker:**
  - **Auto** lets Jev pick the model for each turn and each agent.
  - **A pinned model** is always used for the work. Jev still picks the depth, and records what Auto would have chosen.
- **Context for subagents** comes from the harness, never from another agent:
  - The planner gets the request, the history, and the repos.
  - Builders get the request, the plan, their step, the named files, and what earlier steps changed.
  - The critic gets the request, the plan, the diff, and the check results.

### Audit

The model is CloudWatch-like: everything an agent does is recorded.

- **Hierarchy:**
  - The chat session is the log group.
  - Each agent run is a log stream, with its role, provider, model, effort, and mode.
- **Raw protocol log:** every ACP message in both directions, with timestamp, method, size, and redacted payload.
- **Also kept:** the full agent stderr, receipts, approvals, artifacts, and Jev decisions.
- **Metrics per agent run:** input, output, cached, and thinking tokens, plus cost, context, duration, and tool calls. Cost is labelled reported or estimated.
- **Integrity and privacy:**
  - Records are append-only, with sequence numbers and a hash chain.
  - Secrets are redacted before anything is stored.
- **Retention:** raw logs are kept for 90 days by default, and summaries are kept forever.
- **Recorded today (S1a, `0013_audit.sql`):**
  - `run_protocol_log`: every JSON-RPC message of an agent run, tapped at the transport in both directions, plus the agent's stderr (up to 1 MB per run), redacted and hash-chained per run
  - on `runs`: the model, effort, and mode the agent actually used, `duration_ms`, `tool_call_count`, and `cost_source`
  - not yet: receipts, approvals, artifacts, Jev decisions, and a role per run
- **Audit view:**
  - a summary by model, role, and provider
  - a timeline waterfall
  - logs you can filter by agent, type, and text
  - JSONL and CSV export

### Involvement levels

| Checkpoint           | Hands-on       | Balanced                                      | Hands-off                     | Full auto                                            |
| -------------------- | -------------- | --------------------------------------------- | ----------------------------- | ---------------------------------------------------- |
| Clarify the request  | Jev below 0.75 | Below 0.6                                     | Below 0.5                     | Never; the fixed rules decide                        |
| Approve the plan     | Always         | Multi-file or risky work                      | Destructive work only         | Never                                                |
| Edits and commands   | Every one      | Every edit, and commands not on the allowlist | Commands not on the allowlist | Only pushing, deleting outside the repo, and secrets |
| Retry or escalate    | Always         | When Jev is below 0.9                         | Never                         | Never                                                |
| Keep, fix, or revert | Always         | Always                                        | Kept by default               | Kept by default                                      |

- **Budgets and Stop** apply in every level.
- **The harness answers permission requests itself.** Agents stay in their normal modes and are never put in bypass mode, so every action still has a receipt and can be reverted.

## Open questions

1. **Auto-review.** Decision 3 says Jev chooses whether to review. Should a Jev-recommended review start by itself after a Do run (using the other account's quota), or stay a pre-filled one-click button? This plan assumes the button.
2. **Plan history detail.** Is a timeline of added, removed, and completed entries enough, or do you want to step through every snapshot of the full checklist?
3. **Jev before Chat runs.** Phase 1 records advice for every run, including plain chats with no folder. Should Jev be asked only for linked-folder runs, to send less task text to TypeSafe?

## Decisions (September 25, 2026)

1. **Default mode in a linked folder** follows the user's default permission for that provider (set in onboarding or Settings, and overridable per chat). There is no separate folder default.
2. **Commands with auto-accept.** Each project gets its own allowlist, for example `pnpm test`, stored on the project. A command on the list runs without asking. Any other command asks. The card offers "Always allow in this project", which adds the command to the list.
3. **Reviewer.**
   - Use the other connected provider when there is one.
   - Once Jev is connected, it chooses whether to review and which provider, model, and effort to use.
   - Jev's advice is recorded on the run. The harness still enforces approvals, and Jev's choice can never grant permissions.
4. **Cost.** No default cost cap. Show usage and cost for each run, totals for the chat, and totals per provider, including context use per provider. The per-run cap stays optional in Settings.
5. **OS sandbox.** Follow the ACP guidance.
   - The client's file handlers and permission requests are the boundary the client controls.
   - Each agent's own sandbox covers the rest: Claude's permission modes with its tools limited. Codex runs a patched codex-acp 1.13.1 whose `read-only` mode is a true `readOnly` sandbox (upstream codex-acp#480), so it may read linked repos in Ask. Its sandbox can read the whole disk, a known gap.
   - M1 ships without `sandbox-exec`. Tools that reach the disk without our handlers are listed as known gaps.
6. **Crash during a Do run.**
   - Take a snapshot when the run starts: a git ref of the working tree, or, outside git, copies of the files the harness writes.
   - After a crash, show what changed and offer "Revert to before this run" as well as "Keep changes".
   - Revert only touches files changed during the run, and it needs one confirmation.
