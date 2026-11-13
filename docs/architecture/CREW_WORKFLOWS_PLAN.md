# Crew and workflows: build plan

> **Status: Waves 0 to 3 except stream I (canvas editing) are merged on `crew-workflows-foundation`: Wave 0, the Relay removal, streams A, B, D, E, E2, C, F, G and H. `AGENTS.md` has its integration pass (one Sparks and workflows paragraph, the always-a-card rule for the Spark tools, `spark_crew_edit` in Ask Spark's excluded list, the Spark and workflow card among those Ask Spark never answers, and the folder write refusal among the fixed rules).** Agreed in a planning session on 2026-11-12. This changes `docs/product/PLAN.md` §17, which defers "a visual workflow builder": the owner has asked for it. That line is updated.

Mocks for every screen: `docs/design/mocks/crew-workflows-mock.html` (15 screens, ids `g h i d j k a b l m c f e n o` in flow order). They are sketches, not built from app components.

## What we are building

1. **A Sparks page** in the left bar with two tabs, **Crew** and **Workflows**. Sparks leave Settings; the Home roster stays.
2. **A Spark is a folder.** The form is the default; a Spark gains skills (instructions plus scripts) only when it needs them.
3. **A workflow** combines Sparks into steps that run in order or side by side.
4. **Three ways to try and run:** Preview (no agents), Test run (real agents, thrown away), Run (by hand, `@name` in a chat, or on a schedule).
5. **Agents can build and edit** Sparks, skills and workflows, only through a card the user allows.
6. **A builder chat** docked on the Sparks page for creating them by talking to an agent.

## Decisions made

| Topic                       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage                     | `<data>/<channel>/sparks/<spark>/` and `<data>/<channel>/workflows/<id>.json` (JSON, so no YAML dependency is added; users edit through the page, agents through tools). Spark the app reads, writes and deletes them.                                                                                                                                                                                                                                                                                        |
| One owner per piece         | The database keeps a Spark's identity (id, name, look, default provider, model, mode, level, projects) and all run history. The folder owns instructions, skills and scripts. Workflow definitions are files.                                                                                                                                                                                                                                                                                                 |
| Spark folder                | `SPARK.md` (instructions), `skills/<skill>/SKILL.md` with `name` and `description` frontmatter, any other files beside it. The 2,000-character instruction limit goes away.                                                                                                                                                                                                                                                                                                                                   |
| Skill loading               | The Spark's brief lists each skill's name and description; the agent reads the files when it needs them. No dependency on a provider's own skill loader.                                                                                                                                                                                                                                                                                                                                                      |
| Agent edits                 | Only through Spark tools, each change a card showing before and after, in every mode. Answered by the user on the Mac only; never by Ask Spark or a paired device. Checked against the file's hash before writing. Audited.                                                                                                                                                                                                                                                                                   |
| Direct writes               | The agent's own file and shell tools are denied writing to the crew and workflow folders, in every mode, the way the rules file is protected. Reading is allowed.                                                                                                                                                                                                                                                                                                                                             |
| Reading other Sparks        | Any chat agent on the Mac can list every Spark with its role and skills and read any Spark's files through `spark_crew` (stream C), at once in every mode, so it can check for an existing Spark or skill before proposing a new one. `spark_crew_edit` names similar existing Sparks and skills on the card when it creates one. Every chat turn may also read the whole `sparks` and `workflows` folders directly (owner's decision, 2026-11-13); changes stay refused. Owner asked for this on 2026-11-13. |
| Where the tools are offered | Every chat turn on the Mac. Not to a run from a paired device, a spoken run, a child run, or a Spark working a workflow step.                                                                                                                                                                                                                                                                                                                                                                                 |
| Workflow shape              | Steps with `spark`, optional `prompt`, `dependsOn` (several parents), `join` (`all` or `any`), `onFailure` (`stop` or `continue`). No loops. Checked on save: no cycles, every Spark exists.                                                                                                                                                                                                                                                                                                                  |
| Step outputs                | Each step's output is a note passed to the steps that depend on it. No shared state.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Authority                   | Nothing a workflow or schedule writes is the user's message. It never authorises a push, a pull request or a Spark action; the chat's own mode and level decide.                                                                                                                                                                                                                                                                                                                                              |
| Limits                      | No caps, budgets or timers. Time, tokens and cost are measured and shown. A schedule shows an estimate.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Preview                     | Pure function over the workflow file. No agents, no cost. "Pretend this step fails" per step.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Test run                    | Real agents on a temporary worktree. Sends off the computer are refused and listed as "would have been sent". The copy and the run are deleted when the view closes. Cost is real and counted. Also offered for one Spark ("Try it").                                                                                                                                                                                                                                                                         |
| Schedule                    | "Every N minutes, hours, days or weeks", optional days and hours window, project, message. Missed while asleep or closed: run once when back (default) or skip, never once per missed slot. Previous run still going: skip and say so. Spark pause holds it. Finished runs are updates, grouped per schedule.                                                                                                                                                                                                 |
| Builder chat                | An ordinary hidden chat docked on the Sparks page: one agent session from first message to Done, default provider with a picker (a different provider is a new session). Drafts show on the page as "Draft · waiting for you".                                                                                                                                                                                                                                                                                |
| Builder chat cleanup        | Done marks it done with no dialog. Deleted 24 hours later without asking (or at next start if Spark was closed). A new message within 24 hours reopens it. One left without Done is deleted after the **Archive inactive chats** period. The Spark, its files and the audit entries stay.                                                                                                                                                                                                                     |
| Editor                      | List editor with a live graph preview first. Canvas drag editing later, on the same file.                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Assumed, not yet confirmed by the owner

- **Tab names** are "Crew" and "Workflows" under a page titled "Sparks".
- **The builder chat opens from the corner companion** and from a button on the page. The companion is a status panel today; this adds an entry to it.

## Checked in the code (2026-11-12)

- **Scheduler: new.** Nothing fires at a stored time and survives a restart. Every timed loop is an in-process interval started in the API process (`api/main.ts`): the archive sweep, the morning brief (`digest/morning.ts`, a poll plus a daily claim in the database), the week recap, the calendar ticker. `jobs.available_at` is persisted and respected by the claim query but never set to a future time. Stream G follows the morning brief's pattern: poll, compute due runs with `nextRuns` and `missedRun`, claim in the database so a run never starts twice.
- **A Spark handed a job has no shell.** The child run is `ask` (or `chat`) with `role: 'spark'`; approvals are built only when `role === null` (`workflow/agent-turn.ts`), so it gets read tools and no Bash. It is offered Spark action tools (ticket comment and move, `spark_jira_edit`), which show a confirm card. Stream D must add a step kind that may run commands through the gate; scripts cannot run otherwise.
- **Tabs:** `PageTabs` in `apps/web/src/calendar/PageTabs.tsx` (`ariaLabel`, `options`, `value`, `onChange`), used by Today and the meeting page. It is not under `ui/`; stream B moves it there, since the Sparks page is its third user.
- **Adding a page:** the `AppView` union and `VIEWS` in `apps/web/src/app/Rail.tsx`, and a block in `apps/web/src/app/App.tsx`.
- **Provider switch:** sessions are keyed per provider. The new provider gets a hand-off summary (goal, last 6 messages, plan, diff, open items), not the transcript; switching back resumes the old session with a catch-up. The builder chat gets this for free.
- **Hidden chats:** there is no flag. Ask Spark's chat is `profiles.assistant_conversation_id`; lists filter with `LISTED_CHAT` (`persistence/conversation-search.ts`), which also requires `conversations.kind = 'chat'`. Stream H adds a `kind` value for builder chats, which hides them from every list that uses `LISTED_CHAT`.

## What exists to build on

- `teammates` table, `persistence/teammates.ts`, `api/teammate-routes.ts`, `apps/web/src/teammates/` (the edit sheet), `docs/architecture/TEAMMATES.md`.
- `orchestration/spark-handoff.ts` (`handToSparks`), `persistence/orchestrations.ts` (`insertChildRun`), `workflow/execute-run.ts` (`executeChildRun`): a Spark run as a child run of a chat turn, sequential today.
- `packages/contracts/src/outpost-story.ts` (`storyProblems`, `storyOrder`): cycle check and ordering as pure functions, single parent only.
- `apps/web/src/map/tree/`: React Flow with dagre laid out in a worker. Both are already dependencies (MIT).
- `spark_sparks`, `spark_create_spark`, `spark_update_spark` in `spark-mcp/`.
- The rules-file protection and `spark_rules_edit` card as the pattern for protected folders and Mac-only cards.
- Chat worktrees and the private chat folder as the pattern for throw-away copies.

**Name clash:** `apps/server/src/workflow/` is the chat-turn engine. New server code goes in `apps/server/src/crew/` (storage, tools) and `apps/server/src/crew-flows/` (workflow engine, schedules). The user-facing word stays "Workflow".

## Streams

Each stream owns its folders. Shared files have one owner so parallel branches don't collide.

### Wave 0: Foundation (built)

In `packages/contracts/src/`, exported from the package index, each with tests:

| File               | Holds                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `crew-files.ts`    | Slugs, safe paths inside a Spark folder, `SKILL.md` parsing, the folder and file shapes for the file routes                                    |
| `crew-workflow.ts` | The workflow file schema, `workflowProblems` (duplicates, unknown parents, cycles, missing Sparks), `workflowStages`, the list and save shapes |
| `crew-run.ts`      | `planWorkflow` (what starts, what is skipped, whether it is finished), `previewWorkflow`, `workflowOutcome`, the run and step shapes           |
| `crew-schedule.ts` | The schedule schema, `nextRuns`, `runsPerDay`, `missedRun`                                                                                     |

The engine (D) and Preview (E) both call `planWorkflow`, so they cannot disagree about order, joins or failure.

Rules the functions settle:

- A failed step set to **Continue** counts as finished for the steps after it; they still run and get its note.
- After a failure set to **Stop**, nothing new starts; steps already running finish and keep their output; the rest are skipped.
- A step whose parent was skipped or cancelled is skipped, unless it joins on **any** and another parent finished.
- A day or week schedule runs at `from`; a minute or hour schedule runs from `from` to `to` (to midnight when `to` is empty).

Migration numbers (latest on `main` is `0244`): Relay removal `0245`, A `0246`, D `0247`, G `0248`, H `0249`. Each stream writes its own.

### Before A and B: remove Relay

The owner asked on 2026-11-12 to delete Relay, the built-in pull request follow-up Spark, with everything that refers to it. Pull request follow-up stays. Removed: the seeded Spark and `teammates.kind`, its Home card, its instructions in the round preamble (not kept in any form), and its name on round lines. Migration `0245`. It lands on the foundation branch before streams A and B start, because they change the same Spark files; D and E don't and can start earlier.

### Wave 1 (four in parallel)

| Stream                       | Scope                                                                                                                                                                                                                                                                                                                              | Owns                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **A. Crew storage**          | Folder store, move existing instructions into `SPARK.md`, file routes, brief with the skill list, deny rules for direct agent writes (Claude rules, Codex profile, gate), delete with the Spark                                                                                                                                    | `apps/server/src/crew/`, migration `0246`, `TEAMMATES.md`                            |
| **B. Sparks page, Crew tab** | Left-bar item, tabs (move `PageTabs` to `ui/`), cards, edit panel, skills and files tree and editor, empty state and starters, remove Sparks from Settings                                                                                                                                                                         | `apps/web/src/sparks-page/`, `Rail.tsx`, `App.tsx`, `PageTabs`, the Settings section |
| **D. Workflow engine**       | Run a workflow as one turn with a child run per step: parallel stages, `dependsOn`, `join`, `onFailure`, notes passed on, cancel, restart recovery, run records, Run route and `@workflow` mention, a step kind that may run commands through the gate (today's hand-off child has no shell) but not edit project files or publish | `apps/server/src/crew-flows/`, migration `0247`, `spark-handoff.ts`                  |
| **E. Workflow editor**       | Workflows tab, list, empty state, New workflow, list editor with live graph, Preview with pretend failures                                                                                                                                                                                                                         | `apps/web/src/crew-flows/`                                                           |

B and E build against the Wave 0 shapes with a fake API until A and D land.

### Stream D: the step kind that may run commands (design, 2026-11-13)

**Chosen:** a workflow step is the hand-off child run that exists today (`mode: 'ask'`, `role: 'spark'`) with one mark, `route.spark.step` (the step id), and that mark gives it the approval gate a top-level Ask turn already has (`prepareAskRun`). No new run mode, no new role and no new gate rule.

**What that gate does**, checked against `decide()` before building:

- Refused in every mode: file edits, moves and deletes; shell redirects and commands that write files (`rm`, `mkdir`, `echo > file`); `git commit`, `git push`, `git remote`; `gh pr create`, `gh pr merge`, `gh pr comment`, `gh workflow run`; package installs.
- At once in every mode: commands that only read.
- Every other command (a script, a test runner, `curl`) follows the step's own agent mode: at once in Auto, Bypass permissions, Auto review and Full access, an ordinary approval card otherwise. The card is mirrored into the chat like any child run's card.
- The step's agent mode is the Spark's own mode when the step runs on the Spark's provider, otherwise the chat's mode translated to the provider in use (`insertChildRun` gets an optional `agentMode`). The chat's mode and autonomy level are not consulted, which differs from a top-level Ask turn (`askTurnAutoWhy`).
- The provider session is the Ask session: no write tools are offered, so the gate sees every command, including in modes that hide commands from Spark in a Do turn.
- A step's Claude session stays in Claude's Manual mode (`default`) and is never put in Plan mode, whatever the Spark's mode is (`plansThisTurn` is false for a step). The Spark's mode is applied by Spark's gate, not by Claude. Plan mode would let Claude approve commands itself and would move Haiku to Sonnet; see "Found by the real-agent test" below.

**Why this and not a Do child run:** a Do run offers the agent its edit tools and, in several modes, runs shell commands without sending Spark a request. Keeping project files unchanged there would need new rules. The Ask gate already refuses every change it can read, in every mode, and is covered by `approvals/decide-ask-run.test.ts`.

**What it does not stop:** a script the step runs can write files itself; the gate reads the command line, not what the program does. This is the same limit a top-level Ask turn has today, so the safety floor is not weakened, but "a step cannot change project files" is true of the agent's tools and of commands the gate can read, not of an arbitrary script.

**Authority:** a step is never "the user's message". Its Spark action tools never count as asked for (`action-policy.ts` treats a step run like an Ask Spark message), and a run started by the Run route carries the run source `workflow`, which `userText` treats the same way. A step gets no push or pull request tool (`publishScope` is for the chat's own run) and no `spark_terminal_run` (refused in Ask turns).

**Without a project folder** a step runs as `chat` with no tools, as a hand-off does today.

### Stream D: what was built (2026-11-13)

Code is in `apps/server/src/crew-flows/`; tests are `apps/server/test/crew-workflow-*.db.test.ts` and the `*.test.ts` files beside the code.

| Piece            | Where                                                                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workflow files   | `workflow-store.ts`                                                                      | `<data>/<channel>/workflows/<id>.json`, or `SPARK_WORKFLOWS_DIR` (absolute) in tests. Written through a temp file and a rename. The hash is the sha256 of the file text. A save with `baseHash: null` creates and is refused when the file exists; otherwise the hash must match. A workflow with problems is not saved. A file that is not valid JSON for its own name is left alone and not listed.              |
| Run records      | migration `0247`, `run-records.ts`                                                       | `workflow_runs` (with the workflow as it was when the run started, so an edit or delete mid-run changes nothing) and `workflow_run_steps`. `workflow_runs.run_id` is unique: one top-level turn, one run.                                                                                                                                                                                                          |
| Executor         | `run-workflow.ts`                                                                        | Calls `planWorkflow` after every step settles, starts what it returns side by side, marks what it skips, stops when nothing runs. Each step is a child run through `runSparkChild` (`orchestration/spark-child.ts`, shared with the @Spark hand-off). A step gets the full replies of its direct parents; the chat's main agent gets one shortened note (`workflowNote`) and reads full replies with `spark_chat`. |
| In the chat turn | `workflow-turn.ts`, called from `handToSparks`                                           | A turn whose run already has a record runs it. Otherwise `@workflow-id` starts one. The record is closed before the turn's last event.                                                                                                                                                                                                                                                                             |
| Run route        | `start-run.ts`                                                                           | Sends `@id message` into the chosen chat, or a new chat titled with the workflow's name, with run source `workflow`, and writes the record in the same transaction. The main agent does not run for it.                                                                                                                                                                                                            |
| Recovery         | `settleStrandedRuns`, called in the worker's recovery sweep after `recoverExpiredLeases` | A record still `running` whose turn has ended is closed: `outcome_unknown` unless the turn failed or was cancelled; a step that was running takes its child run's end, or fails with "Outcome unknown"; waiting steps are skipped. Nothing is started again.                                                                                                                                                       |
| Brief            | `subagentBrief` (`persistence/spark-mentions.ts`)                                        | A step's Spark brief comes from the `teammates` row through this one function, as for an @Spark hand-off. Stream A swaps the folder in there.                                                                                                                                                                                                                                                                      |

Routes, all refused to a paired device (`never` in `route-rules.ts`):

| Method and path                    | Body and result                                                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/workflows`               | `{ workflows: WorkflowSummary[] }`                                                                                                                                                                               |
| `GET /api/workflows/:id`           | `WorkflowFile`, or 404                                                                                                                                                                                           |
| `PUT /api/workflows/:id`           | `SaveWorkflow` → `WorkflowFile`; 400 with the first problem, 409 when the file changed or already exists                                                                                                         |
| `DELETE /api/workflows/:id`        | 204, or 404                                                                                                                                                                                                      |
| `GET /api/workflows/:id/runs`      | `{ runs: WorkflowRun[] }`, newest first, the last 100                                                                                                                                                            |
| `POST /api/workflows/:id/runs`     | `StartWorkflowRun` → 201 `WorkflowRun`. An optional `Idempotency-Key` header (a UUID) makes a repeat return the first run. `kind: 'test'` starts a test run (stream F). `projectId` is used only for a new chat. |
| `GET /api/workflow-runs/:id`       | `WorkflowRun`, or 404                                                                                                                                                                                            |
| `POST /api/workflow-runs/:id/stop` | Requests a stop of the run's turn and returns the `WorkflowRun`                                                                                                                                                  |

Decisions made while building, confirmed by the owner on 2026-11-13 together with the step design above:

- **Who may start one by `@id`:** only a message the user typed on the Mac (run source `ui`, a queued message, or none). A spoken message, a ticket start, an outpost request, a follow-up round, an Ask Spark message and a message from a paired device leave `@id` as plain text; the paired device gets one line saying workflows start on the Mac.
- **A Spark name wins.** A message that mentions a Spark runs the Spark hand-off and leaves `@workflow-id` as text. One workflow per message.
- **Hand-back** follows the @Spark rule (`mainAgentContinues`): `@id` alone ends the turn with the note; "…, then fix what they found" continues with the main agent. The note is appended to the prompt only, never to the text Spark reads as the user's request.
- **A stop** cancels running steps, skips waiting ones and ends the run `cancelled`. A workflow that stops on a failed step ends its turn `failed`.
- **A missing Spark:** a workflow with a problem does not start (one line in the chat by `@id`, 400 from the route).

Not built here: Test run (F), schedules and the `schedule` and `catch_up` sources (G; `startWorkflowRun` already takes the source), live run events for the run view (E2 can poll `GET /api/workflow-runs/:id` and listen to the chat's run events), guide pages and the `whats-new` row (nothing here is reachable until the Workflows tab lands), and `AGENTS.md`.

Unverified:

- **A real Claude has run a step** (`apps/server/test/crew-workflow.live.test.ts`, see below). A real Codex step has not been tried.
- **Codex steps.** The Codex Ask session's own sandbox was not exercised for a step.
- **A chat with no project** runs steps as `chat` with no tools; the private chat folder is not given to a step.
- **Worker death mid-run** was tested by expiring leases in the database, not by killing a worker process.
- **The run view and the editor** have not called these routes.
- **A message from a paired device** that names a workflow: the refusal line is not covered by a test.
- **Browser specs:** `approvals.spec.ts` passes. `sparks.spec.ts` and `spark-mention.spec.ts` could not be judged on 2026-11-13: the shared browser test database already had the Relay removal applied (`teammates.kind` is gone), so `GET /api/teammates` fails there on this branch before any workflow code runs. Run them again after the Relay removal is merged in.
- **`truncate.db.test.ts`** ("retries a statement that loses a deadlock once") fails on this machine with and without migration `0247`; the rest of `pnpm test:db` passes.

### Found by the real-agent test (2026-11-13)

`apps/server/test/crew-workflow.live.test.ts` runs workflow steps on the installed Claude, with a Spark folder outside the temp folders. It found:

1. **A step in a mode that asks ran a skill script with no card.** Spark ran every Claude Ask session, a step's included, in Claude's Plan mode. On an account where Claude's Auto mode is available, Plan mode uses Auto mode's classifier by default (`useAutoModeDuringPlan`), so Claude approved the command itself and sent Spark no permission request. The audit showed the `Bash` call and no `session/request_permission`. Fixed twice over: a step no longer runs in Plan mode, and every Claude session that is not a Do session is sent `useAutoModeDuringPlan: false`. With either change alone the live run shows `session/request_permission` ("This command requires approval") and an ordinary `execute` card on the step's run.
2. **Top-level Claude Ask turns very likely have the same gap**, since they use the same session settings and Plan mode; this was concluded from the identical configuration, not from a live run. It is not changed here. Sending `useAutoModeDuringPlan: false` to every non-Do Claude session would close it, and would make more cards appear in every chat whose mode asks; the owner decided on 2026-11-13 not to add those cards, so ordinary Ask turns keep Claude's own classifier. A Do session in Plan mode has the same classifier behaviour before plan approval.
3. **A step ran on Sonnet when Haiku was picked.** `pickFor` passed the right model and Claude accepted it; Claude Code itself runs Haiku sessions on Sonnet while in Plan mode. Out of Plan mode a step runs on the model picked: the Spark's own when its provider is connected and in use, otherwise the chat's. A top-level Claude Ask turn on Haiku still runs on Sonnet, because it is still in Plan mode.
4. **A step read another Spark's `SPARK.md` with `cat`** in the Spark's Bypass mode: a command that only reads follows the mode, also outside the project. The owner decided on 2026-11-13 that any agent may read the whole crew folder, so this read is now expected; only changes are refused.
5. **The fake-agent tests cannot see folder isolation**: their default `SPARK_CREW_DIR` (`vitest.config.ts`) is under the temp folder, which every session may read and scripts may write. Not changed here: moving it needs a place outside the temp folders that is cleaned after each run.

After the fix, live results: a script runs at once in the Spark's Bypass mode through the gate (`decided_by: level`), shows a card in Manual and succeeds once allowed, and steps run on Haiku. A step changed no file in its Spark folder (refused by Claude's deny rules) or in the project (refused by the gate).

### Stream E: workflow editor (built, not mounted)

Built in `apps/web/src/crew-flows/` on 2026-11-13. Nothing in the app shows it yet; stream B mounts it.

**What is there**

- `WorkflowsPanel` (no props): the whole Workflows tab. It shows the list (name, step and stage counts, a stage preview with side-by-side Sparks stacked, a problem count, **Edit**, **Run**), the empty state with up to three suggestions built from the first four Sparks (**Side by side**, **One after another**, **Then <last Spark> wraps up**), **New workflow** (name, Blank or a suggestion), the editor and Preview.
- Editor: stages on the left, a read-only graph on the right (`FlowGraph`, React Flow, laid out by dagre in a worker, loaded as its own chunk). A step has move to an earlier or later stage, remove, and details: its Spark, **Runs after** (any other steps), **Start when** (all or any, shown with two or more parents), **If it fails** (Stop workflow or Continue) and an extra prompt. `workflowProblems` shows under the step it names; **Save**, **Preview** and **Run** are off while there is one. **Run** is also off until the workflow is saved. A saved workflow has hold to delete.
- Preview: `previewWorkflow` only, no request. Step back, Play and step forward over the rounds, **Pretend this fails** per step, the result in words (what stopped, what did not start, what still finished) and **Change <step> to Continue**.
- Stage rules of the list editor (`workflow-model.ts`): a Spark added to a stage runs after everything in the stage before it; moving earlier makes it run beside the stage before; moving later hands its followers its own parents, then runs it after the rest of its stage (or after the next stage when it was alone). Removing a step hands its parents to its followers. None of these can make a loop; ticking **Runs after** by hand can, and the check reports it.
- The worker hook is shared with the Map: `apps/web/src/map/tree/use-worker-layout.ts`, used by `use-tree-layout.ts` and `crew-flows/use-flow-layout.ts`. The Map's own layout (`tree-layout.ts`) is not reused: it keeps at most two links per node, which drops workflow edges.

**Routes the client calls** (D had no routes section when E started; `workflows-api.ts` is the only file that names them, and the same table is in the shared notes folder for D)

| Call      | Route                          | Body                                      | Reply                                                                     |
| --------- | ------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------- |
| List      | `GET /api/workflows`           |                                           | `{ workflows: WorkflowSummary[] }` (the wrapper is defined in the client) |
| Get       | `GET /api/workflows/:id`       |                                           | `WorkflowFile`                                                            |
| Save      | `PUT /api/workflows/:id`       | `SaveWorkflow` (`baseHash` null = create) | `WorkflowFile`; 409 with `{ error }` when the hash is stale               |
| Delete    | `DELETE /api/workflows/:id`    |                                           | `null`                                                                    |
| Start run | `POST /api/workflows/:id/runs` | `{}` (`StartWorkflowRun` defaults)        | `WorkflowRun`                                                             |

The client picks a new workflow's id (`crewSlug(name)`, made unique against the list). Run only calls start and shows **Started**; the run view is stream E2.

**How B mounts it**

Render `<WorkflowsPanel />` as the body of the Workflows tab, inside the page's `main.main` (its narrow layout uses the `main` container query). `App.tsx` already loads `ui/controls.css`, which it needs. `useWorkflows()` from `use-workflows.ts` gives the count for the tab. Then delete the stand-in page (`apps/web/crew-flows-preview.html`, `apps/web/src/crew-flows/harness/`, its `knip.json` entry), point `PANEL_PATH` in `tests/browser/crew-flows-kit.ts` at the real page, and remove the spec's skip for production builds.

**Tests**

- Unit: `workflow-model.test.ts` (adding, moving between stages, parents, remove, the stage preview, labels, suggestions), `preview-model.test.ts`, `flow-layout.test.ts`.
- Browser: `tests/browser/crew-flows.spec.ts` (group `crew-flows`): create from the empty state, a suggestion as an unsaved draft, a loop shown inline and Save blocked, save with the opened hash, a deleted Spark, a stale save, delete, Preview with a pretend failure and no request, and one pass with the keyboard alone. It runs against the dev server's stand-in page with the workflow routes faked in the browser (`crew-flows-kit.ts`) and real Sparks from `/api/teammates`. axe runs on the empty state, New workflow, the editor, the list and Preview. Screenshots in light and dark are written to `test-results/crew-flows/`.
- Ran on 2026-11-13: `pnpm check` (passes), and `crew-flows`, the four `project-map` specs and `lazy-ui` in the browser (35 passed, 1 skipped). `pnpm test:browser:changed` and `pnpm test:db:changed` were not run to the end: both select every test, because the local `main` is behind this branch's base and `tests/browser/spec-map.ts` is a run-everything file. This stream changes no server code.

**Unverified or left out**

- Never run against stream D's real routes: the route paths, the list wrapper, the 409 reply and the delete reply are E's assumptions until D lands.
- Not run in the Mac app or on a paired device, and not checked with VoiceOver. The spec is skipped for production and packaged builds because the stand-in page exists only on the dev server.
- The list has no last-run line or run status (mocks `e`); there is no run history to read yet. **Describe it** (mock `k`), the List and Canvas switch and **Test run** belong to later streams.
- No text says a workflow can be started with `@name` in a chat; add it when D's mention exists.
- No guide page and no `whats-new.md` row: nothing is reachable by a user until B mounts the tab. Whoever mounts it adds both.
- The graph is a picture for the list beside it (`role="figure"`, nodes not focusable); every action is in the list. A workflow whose steps wait on each other still draws, with the loop edge drawn badly.
- **New workflow**'s **Start from** options are each a Tab stop (`RadioRow` has no roving tab index); arrow keys also move between them.

### Stream E2: live run view (built, 2026-11-13)

**What is there** (`apps/web/src/crew-flows/`)

- `RunView`: after **Run** (list row or editor) the run view opens with the workflow's graph (`FlowGraph`), each step's state as an icon plus a word (Waiting, Running, Done, Failed, Skipped, Cancelled, and **Needs you** while a step's approval card waits), solid green edges for hand-offs that happened, dashed ones for those that have not, a status line (run state, steps done of total, elapsed time, tokens, cost) and **Stop** while it runs. The outcome line names the step that stopped a failed run, what was cancelled and how many steps never started; `outcome_unknown` says to read the chat before running again; a run whose chat was deleted says the step details are gone.
- **All steps** (`RunStepList`) is the keyboard and screen reader path: every step is a button that selects it. The graph stays a picture. The selected step's panel (`RunStepPanel`) shows its Spark, agent (provider and model), mode, time, output note (Markdown), **Passed to** (buttons that select those steps), **Open the card** when it waits on an approval (opens the chat at the card; the card is answered there) and **Open this step in the chat** (opens the chat at the step's agent block). On a narrow window the graph and the list stack.
- **Runs** under the editor (`RunsList`, newest first: when, how it started, state, duration, cost); a row opens the run view and **Back to the workflow** returns. The Workflows list shows each workflow's last run (state and when) as a button that opens it. `RunRow` takes its state as a node so stream G can pass Skipped or Held.
- A chat turn started by `@workflow-id` shows one line under the user's message: the workflow name, its state and **Open run view** (`WorkflowRunLink`, rendered from `chat/TurnSection.tsx` only when the turn's Spark members carry a workflow step). It opens the Sparks page on Workflows at that run (`run-route.ts`; `openSparksPage` gained a tab argument).

**Live updates: the event stream, not polling.** `run-records.ts` now sends `pg_notify('changes', {kind: 'workflow_run', …})` when a run is recorded, a step starts or settles and the run finishes, like the other tables' change events. `workflow_run` is a new `AppEvent` kind; `app-event-keys.ts` invalidates `crew-workflow-runs` (a new live root), so the run view, the Runs list, the last-run line and the chat line refresh with no timer. The child runs' own events refresh the chat detail, which supplies approval cards and each step's agent. A one-second clock ticks only while a run is running.

**Numbers.** `WorkflowRun` gained `spend` (`tokens`, `costUsd`, `costSource`), summed in SQL from the turn's run and its child runs the same way `orchestrationTotals` sums a chat turn (`COALESCE(total_tokens, input+output)`, `cost_usd`, `mergeCostSource`). Cost is `null` when no run reported or estimated one: the view leaves it out while running and says **cost not reported** after; an estimate shows `~`. Elapsed time is the record's `startedAt` to `finishedAt` (or now), a step's from its own times. Each run step also carries its `dependsOn` from the definition stored with the run, so a later edit to the workflow does not change an old run's graph. Jev cost is not included (no Jev call happens in a workflow turn).

**Shared files changed**

- `packages/contracts/src/crew-run.ts` (`dependsOn` on a run step, `spend` and `workflowRunSpendSchema`), `packages/contracts/src/app-events.ts` (`workflow_run`).
- `apps/server/src/crew-flows/run-records.ts` (the event, `dependsOn`, `spend`).
- `apps/web/src/crew-flows/`: `FlowGraph.tsx` (optional `finished` and `selected`), `flow-graph.css`, `StepState.tsx` (Running gets its own icon), `WorkflowList.tsx`, `WorkflowEditor.tsx`, `WorkflowsPanel.tsx` (the `run` view and `onOpenRun`).
- `apps/web/src/app/live/app-event-keys.ts`, `apps/web/src/sparks-page/sparks-route.ts` and `SparksPage.tsx` (tab request), `apps/web/src/chat/TurnSection.tsx` (one line).
- `apps/web/src/audit/AuditTimeline.tsx`, `audit-views.css` and `tests/browser/audit.spec.ts`: the audit waterfall's `wf-*` classes are now `wfall-*`. Its global `.wf-bar` (absolute, 16px) was overriding the workflow editor's top bar, which sat under the Sparks page header once the audit CSS was loaded.
- `tests/browser/crew-flows-kit.ts` and `crew-flows.spec.ts` (the fake start reply has steps, **Run** now opens the run view), `tests/browser/spec-map.ts`.
- Guide: `docs/guide/workflow-runs.md` (new) and a `whats-new.md` row.

**Tests**

- Unit: `run-model.test.ts` (state words, finished edges, passed to, status line, elapsed time, cost text, stopped-by and outcome texts, waiting approval, last run).
- DB: `apps/server/test/crew-workflow-view.db.test.ts` (a record carries `dependsOn`, its spend matches the orchestration totals, and it announces `workflow_run` changes).
- Browser: `tests/browser/crew-run-view.spec.ts` (group `crew-flows`), against the real routes and worker with the fake provider: Waiting → Running → Done with focus kept on a step while it updates, finished edges, the step panel and Passed to, **Open this step in the chat** and back through **Open run view**; a `#fail` step stopping the workflow with the stopped-by line, a narrow window, the last-run line and the Runs list; **Stop** and the rest by keyboard alone; `@id` in a chat; a step waiting on an approval card (**Needs you**, **Open the card**, Allow in the chat, then Done). axe on the running, failed, Runs and Needs you views; screenshots in light and dark in `test-results/crew-run-view/`, checked.

**Ran on 2026-11-13:** `pnpm check` (format, lint, typecheck, source, docs, knip, contrast and ACP coverage pass; the unit run had 14 failures in 11 unrelated files, timeouts while the machine was loaded, and all 11 files passed on rerun along with this stream's tests); `pnpm test:db` for `crew-workflow-*` (23 passed); browser `crew-run-view`, `crew-flows`, `sparks-page` (19 passed) and `spark-mention`, `stored-crew-turn`, `sparks`, `audit` (15 passed). `pnpm test:changed`, `test:db:changed` and `test:browser:changed` select every test here (the local `main` is behind, and `spec-map.ts` and `vitest.config.ts` count as run-everything files), so they were not run to the end.

**Unverified or left out**

- Not run in the Mac app, on a paired device or with VoiceOver. Paired devices are refused the run routes (`never`), so the run view, the Runs list and the chat line show nothing there.
- No real agent has run a step (fake provider only; `pnpm test:live` not run).
- A test run (stream F, `kind: 'test'`) is left out of the last-run line and the Runs list; F shows its own.
- The run view reads the chat detail for cards and agents; a run in an archived chat should still show them, but that was not tested.
- `audit.spec.ts` (after the `wfall-*` rename; not compared with the base) failed twice while other sessions loaded the machine, each time on a different test whose first message did not send from the composer, before the waterfall; on a quieter rerun all three passed.
- `outcome_unknown` and a failed run with no stopping step are covered by unit tests only.
- The chat's line reads the workflow's runs list (last 100) to find the turn's run; an older run falls off it.

### Stream B: Sparks page and Crew tab (built against faked file routes)

Built in `apps/web/src/sparks-page/` on 2026-11-13, on branch `claude/crew-page-6189a6`.

**What is there**

- **Sparks** is a left-bar item (`AppView` `'sparks'`, after Tickets; under **More** on a phone) and a page, `SparksPage`, whose root is `main.main.sparks`. Two tabs from `ui/PageTabs` (moved from `calendar/`, with an optional `count` per tab): **Crew** with the number of Sparks and **Workflows**.
- **Crew**: a card per Spark (face, name, role, agent and mode, number of skills), the empty state **Build your crew** with the existing starter suggestions, and **New Spark**, which opens the existing sheet; the new Spark then opens on the page.
- A Spark opens in place with **All Sparks** to go back and two tabs. **Details** is the sheet's fields (`teammates/TeammateFields.tsx`, extracted and shared with `TeammateSheet`), **Edit instructions**, **Save** and hold to delete with the existing 10-second Undo. **Skills and files** is the folder as a tree (`role="tree"`, arrow keys, Home, End, Enter) beside a plain text editor.
- Files: `SPARK.md` is always listed and is the instructions, with no length limit beyond the 256 KB file cap. **New skill** writes `skills/<name>/SKILL.md` with the name and description block. **New file** starts beside the open file. **Rename** (a save to the new path, then a delete of the old one) and **Delete** (confirmed inline) are above the editor; `SPARK.md` and a skill's `SKILL.md` keep their names. `crewPathProblem`, a taken name, a full folder, a skill file without its block and a name that differs from its folder show inline and hold **Save**. ⌘S saves.
- Save sends the hash the file was opened with. A 409 shows "This file changed since you opened it" with **Reload** and **Save mine over it** (reads the newest hash, then saves). Unsaved text is kept per file in memory (`file-drafts.ts`) with the hash it started from, so opening another file or leaving the page loses nothing and a stale draft still conflicts; the tree marks such files **Edited**.
- Settings has no **Crew** section any more (`SparksSection` deleted, `'sparks'` gone from `SETTINGS_SECTION_IDS`, the Settings window no longer mounts `TeammateHost`). The island target `sparks` opens the page (`sparks-route.ts`, `openSparksPage`). Home's roster stays and has **Manage**, which opens the page.
- Paired device: the page lists Sparks and opens one as read-only facts with the line "Edit this Spark, its instructions, skills and files on the Mac."; no **New Spark**, no tabs, and no folder request is made.
- Guide: `sparks.md` rewritten for the page, the **Crew** row removed from `settings.md`, a line in `home.md`, a row in `whats-new.md`.

**Routes the client calls** (`crew-files-api.ts` is the only file that names them)

| Call   | Route                                   | Body           | Reply                                                                          |
| ------ | --------------------------------------- | -------------- | ------------------------------------------------------------------------------ |
| Folder | `GET /api/teammates/:id/folder`         |                | `SparkFolder`                                                                  |
| Read   | `GET /api/teammates/:id/files?path=`    |                | `CrewFile`; 404 when it is gone                                                |
| Save   | `PUT /api/teammates/:id/files`          | `SaveCrewFile` | `CrewFile`; 409 when the hash is stale, or the path exists and `baseHash` null |
| Delete | `DELETE /api/teammates/:id/files?path=` |                | 204                                                                            |

What B assumes of A beyond the contract: `SPARK.md` may be missing from `files` (B then saves it with `baseHash: null`); a folder with no files left disappears from `files`; `problems` carries one text per path; the card's skill count is `skills.length` from one folder request per Spark (a count on `GET /api/teammates` would save up to 50 requests).

**Mounting stream E's Workflows tab**

Everything is in `apps/web/src/sparks-page/WorkflowsTab.tsx`:

- lines 5 to 15, `WorkflowsTab`: replace the body with `return <WorkflowsPanel />;` (import from `../crew-flows/WorkflowsPanel.tsx`). `SparksPage` renders it as a direct child of `main.main`, a column flex box with the `main` container, which is what the panel's layout needs.
- lines 1 to 3, `useWorkflowCount`: return `useWorkflows().data?.length ?? null` (from `../crew-flows/use-workflows.ts`) for the tab count.

Then delete `.spk-soon` from `sparks-page.css`, and do E's own clean-up (its stand-in page, harness, `knip.json` entry, `PANEL_PATH`).

**Tests**

- Unit: `folder-model.test.ts` (tree building and order, rows under closed folders, the new-skill text parsing back, name, path and rename problems, the full folder, skill-file problems, byte size, 409 handling).
- Browser: `tests/browser/sparks-page.spec.ts` (group `sparks`), with the four file routes faked in the browser (`crew-files-kit.ts`) and real Sparks: the empty state and starters, New Spark through to its card, a skill and a script with every inline problem, save, rename, delete, a save conflict both ways, drafts surviving navigation, one pass with the keyboard alone (including 28px control heights), Settings without the section and Home's **Manage**, a phone at 390px and a paired device. axe runs on each screen. Screenshots in light and dark go to `test-results/sparks-page/` and were looked at.
- Changed: `sparks.spec.ts` (delete and the failed delete now go through the page; the Settings test is gone), `settings-lists`, `settings-groups`, `responsive-shell` (no **Crew** section; **Sparks** under **More**), `desktop-companion` (the island target opens the page), `rail-shortcuts` (nine items on the web build, so the last digit is tested as well as the one past it).

- Ran on 2026-11-13: `pnpm check` (format, lint, typecheck, source rules, guide rules, knip and the rest pass; the unit run had one failure in `apps/desktop/src/voice/voice-models.test.ts` while browser tests ran beside it, and that file passes alone), `pnpm test:changed` (843 files, 8,246 tests pass; an earlier run under the same load showed 2 failures that were not captured and did not come back), and in the browser `sparks-page`, `sparks`, `spark-sheet`, `settings-lists`, `settings-groups`, `responsive-shell`, `desktop-companion`, `lazy-ui` and `home` (71 passed). `rail-shortcuts` was run on this Mac from a copy with ⌥⌘ in place of Ctrl+Alt (3 of 4 pass; the title test expects the non-Mac "Ctrl Alt" text and fails on any Mac, before this change too). `pnpm test:browser:changed` and `pnpm test:db:changed` were not run: the first selects every spec because `app/` and `spec-map.ts` changed, and this stream changes no server code.

**Unverified or left out**

- Never run against stream A's real routes; the reply shapes, the 404 and the 409 are the contract's and B's reading of it. No test with a real agent: this stream runs none.
- The sheet still has **Standing instructions** (2,000 characters, **Use a file…**) for **New Spark** and for the edit sheet Home's pencil and the island's `spark-edit` open. Once A makes `SPARK.md` the owner, that field should go from the sheet, or `POST /api/teammates` should write it to `SPARK.md` and lift the limit; this is A's call and is not done here.
- With the Browser pane the Mac's left bar now has nine items, so **Remote** is the tenth and has no ⌥⌘ digit. In a window under about 760px tall the left bar scrolls, as it already could.
- Rename is two requests; if the delete fails the file exists under both names and the message says so. Folders and whole skills cannot be renamed or deleted in one step, and there is no import of a skill folder.
- The editor is a plain text area: no syntax colours, and Tab moves focus.
- A paired device cannot edit a Spark on this page even with the Settings switch on (the sheet from Home still can); the plan keeps editing on the Mac.
- "Describe one and let an agent draft it", "Try it", "Used in" and "Add to a workflow" from the mocks belong to streams H, F and E and are not here.
- Not run on the Mac app itself (Electron); checked in Chromium through Playwright only. VoiceOver was not tried; the tree follows the ARIA tree pattern and passes axe.

### Wave 2 (four in parallel)

| Stream                       | Scope                                                                                                                                                                                                                       | Needs               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **C. Agent tools and cards** | `spark_crew` (read) and `spark_crew_edit` (Sparks, skills, files, workflows) with the before-and-after card, Mac only, hash check, audit; keep the tool budget test passing; guide reference page read through `spark_docs` | A                   |
| **F. Test run**              | Temporary worktree, refuse and list sends, cleanup on close and at startup, "Try it" for one Spark                                                                                                                          | D                   |
| **G. Schedules**             | Scheduler, schedule table, catch-up, skip on overlap, pause, Schedule tab, run history, estimate line, grouped Updates line                                                                                                 | D, migration `0247` |
| **E2. Run view**             | Live status on the graph, step output panel, time, tokens and cost line, Stop                                                                                                                                               | D, E                |

### Stream C: agent tools and the card (built, 2026-11-13)

Code: `apps/server/src/crew/` (planning, writing, similarity, who is offered the tools), `apps/server/src/spark-mcp/tools/crew-tool.ts` and `crew-edit-tool.ts`, `apps/server/src/spark-mcp/actions/crew-edit-perform.ts`, `packages/contracts/src/crew-edit.ts`, and the card in `apps/web/src/chat/approvals/CrewEditFacts.tsx`.

**The two tools**

| Tool              | Input                                                                                                                                                                                        | Result                                                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spark_crew`      | nothing; or `spark` (name or id), with `path` for one file; or `workflow` (id)                                                                                                               | Every Spark (id, name, role, agent, mode, skills with name and description) and every workflow (stages as `step: Spark`); a Spark's file list, skills and problems; one file's text and hash; one workflow with its hash. At once in every mode. |
| `spark_crew_edit` | `spark` with `files` (`{path, text}`, `text: null` deletes) and/or `remove` (a skill folder); or `workflow` (the file, a step may use `spark` for a name); or `remove` alone (a workflow id) | `waiting_for_user` with the card's id, `unchanged`, or `problems` (a list of `{path, text}`, no card). Never writes by itself.                                                                                                                   |

`spark_crew` reads through `crew/spark-folder.ts`, `crew/spark-skills.ts` and `crew-flows/workflow-store.ts`; no file-system allowance changed. Its results are the user's own crew, so the tool is not marked as returning work data and a read does not set the send flag. Each file or workflow read is an audit entry `spark/crew_read` (Spark or workflow id, path, bytes).

**What is checked before a card** (each problem goes back to the agent with its path): `crewPathProblem`; a path given twice; text over 256 KB, a NUL or a lone surrogate; a delete of a file that is not there; a path that is a folder or has a file in the way; a 201st file; `parseSkillFile` and the skill's name equal to its folder; a skill folder that would be left without `SKILL.md`; more than 20 files or 512 KB of before-and-after text in one call; a skill folder to remove that does not exist; for a workflow, `workflowSchema`, an unknown Spark name, `workflowProblems`, and a file on disk that is not a valid workflow. Files whose text would not change are dropped; a call that changes nothing answers `unchanged`.

**The card** is the Spark action `crew_edit`, titled "Change the <name> Spark?" or "Change the <name> workflow?", with **Allow** and **Deny**. It holds each file's path, whether it is new, changed or deleted, the full text before and after, and the hash the change was planned against. The web card draws each file with the existing diff view (`DiffView`, with two new options: a badge text, and all rows, which shows every line with no 300-row cut and no folded unchanged lines); a workflow card also shows its steps in order. Nothing focuses a button and no key answers it. The create and update Spark cards no longer count as asked for (`action-policy.ts`), so their confirm button is not focused either; an update that empties the instructions deletes `SPARK.md`. A paired device sees the card and the diffs with "Waiting for you on your Mac. Answered on the Mac only." and no buttons, and the gateway refuses its answer (`macOnlyCard`). Ask Spark cannot answer it (`ASK_SPARK_REFUSALS.crew`). It is an ordinary pending approval, so attention shows it as `approval:<id>`.

**Duplicates.** A new skill is compared with every skill of every Spark, and a Spark's first `SPARK.md` with the other Sparks, by name (same after dropping case and punctuation; one inside the other; one or two letters apart) and, for skills, by description (three or more shared words that cover 60% of the shorter one). Up to eight are named on the card: "You already have the release-notes skill of Scribe (similar name)."

**Writing.** After **Allow**, `crew/crew-edit-apply.ts` reads every file again and compares its hash (a new file must still be missing). Any difference fails the card with "Changed since the card was shown: <paths>. Spark changed nothing." before anything is written; deletes are then done before writes, each through the store's own hash check. A workflow goes through `workflowStore().save` with the hash, or a hash compare and `remove`. The Spark's chats' provider sessions are closed, as the file routes do. The agent learns of a conflict the next time it calls the tool in that chat (`lastAttempt` on the result) and from the card's result line; the tool call that raised the card has already returned.

**Audit.** `spark/crew_edit` entries: waiting (when the card is raised), done, failed or `conflict` (after Allow) and `denied` (written by the approval route), each with the target, id and per file the path, change and sizes before and after, never text.

**Who gets them** (`crew/tool-offer.ts`, through `sparkAvailability`):

| Run                                                                                      | `spark_crew` | `spark_crew_edit` |
| ---------------------------------------------------------------------------------------- | ------------ | ----------------- |
| A chat's own turn on the Mac                                                             | yes          | yes               |
| A read-only (Ask) turn, Ask Spark                                                        | yes          | no                |
| A turn from a paired device, a spoken turn, a child run (an @Spark job, a workflow step) | no           | no                |

A session without them is told why in the tool instructions, like the rules and plugin tools. Both tools check again when called.

**Decided here: `spark_create_spark` and `spark_update_spark` now always show a card, answered on the Mac only.** Before, they followed the agent's mode, so an agent in Auto or Bypass permissions could write a Spark's instructions (which are `SPARK.md`) and change its default mode and autonomy with no card, which contradicts "every change is a card". Both now pass `alwaysAsk`, their cards are in `macOnlyCard` and refused to Ask Spark's answer, the create card names similar Sparks, and the update card shows the instructions before and after. They are still offered to Ask Spark and to a turn from a paired device (the card then waits on the Mac); only `spark_crew_edit` is withheld there. `AGENTS.md` still lists Sparks among the action tools that follow the mode; the integration pass must change that line.

**Tool budget.** The plain-chat list was at 26,998 of 27,000 characters before this stream. The two tools take 1,237 (441 and 796); the room came from shortening `spark_sparks`, `spark_create_spark` and `spark_update_spark` (4,498 to 3,233). Now 34 tools, 26,970 characters. The test also caps the two crew tools together at 1,300.

**Also changed:** `packages/contracts/src/spark-actions.ts` was at the 500-line limit, so the Spark result shapes moved to `spark-result.ts` (same exports). `crew/spark-folder.ts` exports `crewTextProblem`. Guide: new reference page `crew-files.md`, rows in `spark-tools.md` and `whats-new.md`, a line in `sparks.md`, and the `spark_guide` tools section.

**Tests.** Unit: `crew/similar.test.ts`, `crew/crew-edit-plan.test.ts` (every problem above, multi-file plan, apply, conflicts, workflows), `CrewEditCard.test.tsx`, one case in `DiffView.test.tsx`. Database: `apps/server/test/spark-crew-tools.db.test.ts` (reads and their audit, the card in three modes, Allow, Deny and its audit, a conflict after the card, delete of a file and a skill folder, the duplicate hint, the same card asked twice, workflow create, change with a conflict and delete, each run kind that must not get the tools, the two Spark tools always asking). Browser: `tests/browser/spark-crew-edit.spec.ts` in the `sparks` group (new files shown in full, changed lines, Allow writes; a delete is not confirmed by Enter and Deny keeps the files; a file changed after the card is not overwritten; a paired device has no buttons).

**What ran (2026-11-13):** `pnpm check` on `9beea1da6`: format, lint, typecheck, source rules, guide rules, knip, contrast and ACP coverage pass; the unit run had 13 failures in 12 files outside this stream (timeouts and speed caps, under load), and those 12 files pass when run alone (149 tests), `pnpm test:db:changed`, which selected the whole db suite (3,324 passed; `decision-export` timed out in a hook and one `task-changes` case got a 404 while `pnpm check` ran beside it, and both files pass when run alone), and in the browser `spark-crew-edit`, `spark-actions`, `spark-decisions`, `spark-mention`, `spark-sheet`, `sparks`, `sparks-page`, `approvals`, `spark-rules-edit`, `spark-plugins-edit` and `spark-rule-card` (57 passed). `pnpm test:browser:changed` selects every spec (a contracts change maps to all) and was **not** run in full.

**Unverified or left out**

- **No real agent has called either tool.** Every test drives the MCP server directly or seeds the card; `pnpm test:live` was not run. Whether Claude or Codex fills `workflow` (a free-form object in the schema, described in one line, to save budget) correctly without reading `crew-files` first is unknown.
- **The paired-device refusal in the browser** is the page with `remote: true` faked; the gateway's refusal is covered by `macOnlyCard` in the database test, not by a request from a paired device.
- **A conflict is not pushed to the agent.** It sees it on its next call or when the user tells it; no Spark message is queued.
- **A write that fails half way** (a conflict between the first check and a later file) leaves the earlier files written and says which; there is no rollback.
- **Retry** on a failed card runs the same stale change and fails the same way.
- **A top-level turn started by a workflow or schedule** is the chat's own turn, so its main agent is offered both tools; the card still asks. Only step children are refused.
- **A Spark cannot be deleted by an agent**, and a skill folder with more than 20 files must be deleted in two calls.
- **The similarity check is words and letters only**; it will miss a duplicate described differently and can name an unrelated skill.
- **Workflow cards show the JSON file**, with Spark ids in it; the step line above it has the names.
- Not run in the Mac app, with VoiceOver or in dark mode; the card was looked at in one light screenshot.
- `AGENTS.md`, `TEAMMATES.md` and `REPO_AGENT_CONFIG.md` are not edited by this stream.

### Stream G: workflow schedules (built, 2026-11-13)

Server code is in `apps/server/src/crew-flows/` (`schedule-records.ts`, `scheduler.ts`, `schedule-routes.ts`), the decision is a pure function in `packages/contracts/src/crew-schedule-slots.ts` (`decideDue`), and the tab is `apps/web/src/crew-flows/Schedule*.tsx` with `schedule-model.ts`.

**Where the schedule lives: the database** (`workflow_schedules`, migration `0248`, one row per workflow). The workflow file stays the definition and nothing else. A schedule holds a project id, the chat its runs go to and the last time it was checked, which are this Mac's state and change on every poll; putting them in the file would change its hash under an open editor and under `spark_crew_edit`'s hash check. The schedule is deleted with its workflow by the delete route, and the scheduler deletes the schedule of a workflow whose file is gone (covers a file removed any other way).

| Piece                    | How it works                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Poll                     | `startWorkflowScheduler` in `api/main.ts`, every 30 seconds, off with `WORKFLOW_SCHEDULES=false` (the browser specs turn it off). The clock is injected (`deps.now`).                                                                                                                                                                                                                                   |
| Nothing starts twice     | Per schedule, one transaction moves `last_checked_at` with a compare-and-swap, decides, and writes the slot row. Only the check that wins the swap acts. A start is a `claimed` row in `workflow_schedule_slots` behind a unique index on the slot time, and its `message_id` is the run's idempotency key, so `startWorkflowRun` returns the same run if it is called again.                           |
| Restart                  | A `claimed` row older than a minute with no run is claimed again (one `UPDATE`) and started with the same message id.                                                                                                                                                                                                                                                                                   |
| On time or missed        | A slot is on time when it came due in the last 5 minutes (`SCHEDULE_LATE_MS`) and since the last check; it starts with source `schedule`. Older slots are missed: `run_once` starts one run with source `catch_up`, `skip` records one Skipped line. A check starts at most one run, so an on-time slot after a gap is the only run.                                                                    |
| Previous run still going | Any `run` of that workflow with status `running` skips the slot (`previous_running`). Repeats extend the same line instead of adding one per slot.                                                                                                                                                                                                                                                      |
| Spark pause              | Slots that come due are recorded as one Held line (`paused`). On resume the line is released and `run_once` starts one catch-up run; `skip` starts none.                                                                                                                                                                                                                                                |
| Cannot start             | A workflow with a problem (`workflowProblems`), a project that is no longer in Spark, or a start that throws is recorded as Not started with the reason.                                                                                                                                                                                                                                                |
| Saving                   | A save sets `last_checked_at` to now, so nothing is owed from before the save, and releases an open Held line. Changing the project drops the schedule's chat.                                                                                                                                                                                                                                          |
| The chat                 | The first run creates a chat titled with the workflow's name in the schedule's project and the schedule keeps its id; later runs are turns in it. While the schedule is on, **Archive inactive chats** leaves that chat alone (`inactive-chats.ts`); with the schedule off or deleted it is archived like any chat. A chat the user archived or deleted is not reopened: the next run starts a new one. |
| Authority                | Unchanged from stream D and checked by a test: `startWorkflowRun` sends the message with source `workflow`, `loadRunInput` reports it as `assistantSent`, and `userText` returns nothing for it, so it can't count as asking for a push, a pull request or a Spark action.                                                                                                                              |
| Routes                   | `GET /api/workflow-schedules` (for the chips), `GET`, `PUT` and `DELETE /api/workflows/:id/schedule`, and `GET /api/workflows/:id/schedule/slots`. Skipped, held and not-started slots are listed by the slots route, **beside** the runs listing, which is unchanged; the tab merges the two. All five are `never` in `route-rules.ts`.                                                                |
| Updates                  | No new attention kind. A schedule's chat already yields one `run-done` or `run-failed` update for its latest turn; that item now carries `schedule` (workflow, name, runs today, failed today) and Home prints "Pre-PR review: 12 runs today, 1 failed". An earlier failed scheduled run of today that the user has not seen gets its own `run-failed` item. None is blocking.                          |
| Tab                      | Switch (saves at once), Every with unit, Only on, Only between or At, In project (with **Add folder…** and **Clone a repository…**), the message, what to do when missed, the next three runs, the estimate and Recent runs. A chip with the schedule shows on the workflow's row and beside its title while the schedule is on. Times follow the Mac's clock setting (`hourCycle`).                    |

**Tests:** `apps/server/test/crew-schedule.db.test.ts` and `crew-schedule-routes.db.test.ts` (every row above, the routes and their remote rules), `packages/contracts/src/crew-schedule-slots.test.ts`, `apps/web/src/crew-flows/schedule-model.test.ts`, `tests/browser/crew-schedule.spec.ts`.

**Not verified, and limits:**

- A real overnight sleep and wake, and a real quit and relaunch of the Mac app, were not run. The gap, pause and restart cases are tested with an injected clock against PostgreSQL only.
- No scheduled run was taken to the end with a real agent; the database tests check that the run is created and queued, and stream D's tests cover what a run does.
- The browser spec runs on the dev-server preview page with faked schedule routes, like the Workflows panel spec. The tab was not exercised against the real routes in a browser.
- The poll runs only while Spark is open; nothing wakes the Mac.
- Recent runs shows how long a run took but not what each cost; the estimate uses the cost of the last finished run, summed over its steps.
- The grouped Updates line counts by the calendar day of the API process. The finished-turn Web Push (off by default) is not grouped: a paired device with it on gets one push per scheduled run.
- `AGENTS.md` and the Sparks guide's workflow pages are left for the integration pass.

### Wave 3

| Stream                | Scope                                                                                                                                                                                 | Needs               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **H. Builder chat**   | A `conversations.kind` value for builder chats, dock on the Sparks page, provider picker, drafts on the page, Done, delete after 24 hours, cleanup of abandoned ones, companion entry | C, migration `0248` |
| **I. Canvas editing** | Drag Sparks, draw connections, step inspector, Tidy up, keyboard path for every action                                                                                                | E                   |

### Later, not planned in detail

- Steps that change code, push or open pull requests, through outposts (needs several parents per story task).
- Conditions on a step ("only if Security found something", "stop early when nothing is new").
- Starting a workflow on an event, such as a chat opening a pull request.

## Stream F: test run (built, 2026-11-13)

Code is in `apps/server/src/crew-flows/test-run.ts` and `held-sends.ts`, `apps/web/src/crew-flows/TestRun*.tsx`, `TrySpark.tsx` and `test-run-*.ts`. Tests: `apps/server/test/crew-test-run.db.test.ts`, `held-sends.test.ts`, `test-run-model.test.ts`, `tests/browser/crew-test-run.spec.ts`. Guide: `docs/guide/test-run.md`.

### Decisions

| Topic                  | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hidden chat marker     | `conversations.kind = 'crew'` (migration `0249`, constant `TEST_RUN_CHAT_KIND`): a chat the Sparks page owns. Every list that requires `kind = 'chat'` already leaves it out (chat list, History, search, auto-archive, recaps, digests, the calendar planner), and the island, Dock badge, Mac notifications and Home drop items whose chat is not in the list. Three places had no kind filter and now exclude it: `attention-items.ts`, `chatOf` (phone push and Slack) and `spark_attention`'s pending cards. **Stream H shares this value** for builder chats; what tells the two apart is the owning row (a test chat has a `workflow_runs` row with `kind = 'test'`).                                                                                                                                                                                              |
| The copy               | A git worktree of the project's `HEAD` under `<project>/.spark/worktrees/`, made with `createCopy` (the function a chat's worktree uses, dependencies included) on a branch `spark/test-run-<chat id>` (the whole id: the start of a UUIDv7 is a timestamp, so a prefix would collide between test runs started within a minute), recorded as the hidden chat's `chat_worktrees` row. Steps find it through the SQL every run already uses for its roots, so `run-input.ts` did not need a new path. Uncommitted changes are not in the copy. A project that is not a git repository is refused with a 400.                                                                                                                                                                                                                                                               |
| No project             | The hidden chat has no project. Steps run as `chat` with no tools, exactly as in an ordinary run (stream D), so there is nothing to hold; the chat's private folder is removed with the chat.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| What is held           | (1) Every Spark tool marked `acts` (tickets, Jira, Confluence, ServiceNow, Slack, calendar, `spark_push`, `spark_pull_request`, browser act, Mac control, outposts, MCP server changes, Sparks, artifacts) and `spark_browser_open` (`AGENTS.md` counts opening a page as a send), in one place, `callSparkTool` (`heldInTestRun`). Code Mode's `spark_execute` offers only tools without `acts` and calls them through the same function. (2) In the approval gate, before any other decision: a command that publishes (`publishesCode`: `git push`, `gh pr create`, other `gh` writes) or that the gate classifies as a send (`egressOf`: `curl`, `ssh`, `npm publish`, …). A hosting read such as `gh pr view` is not held. Each is refused before it runs and written to `workflow_held_sends` (run, kind, a one-line summary through `redactText`, 200 characters). |
| What is not held       | Reads: Spark read tools, `spark_browser_read` on a tab that is already open, and the agent's own `WebFetch` and `WebSearch` (`AGENTS.md` treats these as reads; the gate still refuses a fetch to this computer). Tools of an MCP server the user added are declined in every step already (an Ask run) and are not listed. A script that opens its own connection is not seen by the gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| What the agent is told | `TEST_RUN_NOTE` in the step prompt, and the refusal text of each held action, say it is a test run, that the action was listed for the user and not to retry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Cards                  | The approval gate stays on. A step whose mode asks raises its ordinary card in the hidden chat; the view shows it with **Allow once** and **Deny** (`POST /api/approvals/:id/decision`), since no other surface shows it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Ending                 | `DELETE /api/workflow-runs/:id` stops the turn, removes the worktree and its branch (always, since it is a throw-away), deletes the chat (runs, messages, held sends by cascade), provider work folders, the chat folder and the run row with its steps. The view calls it on **Discard**, on unmount and on `pagehide` (keepalive). `sweepTestRuns` runs once when the API starts and discards every test run.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Run for real           | The web starts an ordinary run (`kind: 'run'`) with the test's message and project, then discards the test. No new route.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| One Spark              | `POST /api/teammates/:id/test-runs` builds a one-step workflow (id and step `try-it`, name = the Spark's name) that is never saved and runs it through the same path; `workflow_runs.one_spark` marks it. No **Run for real** there.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Run history            | `GET /api/workflows/:id/runs` lists `kind = 'run'` only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Routes added (all `never` for a paired device)

| Method and path                     | Body and result                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `POST /api/workflows/:id/runs`      | `kind: 'test'` with `projectId` and `message` now starts a test run; `conversationId` is ignored for it    |
| `POST /api/teammates/:id/test-runs` | `StartSparkTestRun` → 201 `WorkflowRun`; 404 for an unknown Spark; honours `Idempotency-Key`               |
| `GET /api/workflow-runs/:id/test`   | `WorkflowTestRun`: the run, message, project, `held`, `waiting` cards and `usage`; 404 for an ordinary run |
| `DELETE /api/workflow-runs/:id`     | 204; 404 when gone, 400 for an ordinary run                                                                |

### Changes outside `crew-flows/`

- `run-workflow.ts`: `launch` adds `test: true` to `route.spark` and `testRun` to the step prompt when `turn.run.kind === 'test'`. Nothing else.
- `run-records.ts`: `insertWorkflowRun` takes `oneSpark`; `listWorkflowRuns` filters `kind = 'run'`.
- `run-input.ts` (`testRun` from `route.spark.test`), `agent-turn.ts` (one line, `sparkScope.testRun`), `do-run.ts` (`holdsSends` on the Ask gate), `approval-gate.ts` (the hold before `decideRuled`), `spark-mcp/server.ts` and `deps.ts` (`scope.testRun`), `crewSparkSchema` (`test`).
- `attention-items.ts`, `slack/notifier.ts`, `spark-mcp/tools/attention-tool.ts`: exclude `kind = 'crew'`.
- `api/startup-prune.ts` and `api/main.ts`: `sweepAtStart`.
- `WorkflowEditor.tsx`: a **Test run** button and the view in place of the editor body. `SparkDetails.tsx`: a **Try it** section after the form.

### To share with stream E2 once both are merged

- Polling `GET /api/workflow-runs/:id` and the "is it still running" rule (`polls`).
- The step list with states and the step output panel (`TestRunView` renders `steps[].note`).
- The time, tokens and cost line (`progressLine`, `elapsedMs`, `stepTime` in `test-run-model.ts`), and the usage sum (`usageOf` in `test-run.ts`) if the run view wants it from the server.
- `FlowGraph` with `states`, used the same way by both.

### Known limits

- **Cost after Discard.** The cost is shown while the view is open. Discard deletes the runs, so Spark's Usage and Analytics no longer hold it afterwards (the same happens when any chat is deleted). The mock's "is counted" would need a spend ledger that outlives runs; the guide says "the cost is real" and does not promise a record. Owner decision needed.
- **While it runs**, a test run's turns are in Usage and Analytics, and its change events reach the web app like any chat's.
- **The agent's own web tools** (WebFetch, WebSearch) are not held: a GET with data in the address could carry it out. Opening a page in the Browser pane is held.
- **A script** that reaches an outside service by itself is not stopped (stated in the form, the view and the guide).
- **The copy is `HEAD`**, without uncommitted changes, and the project must be a git repository.
- **The start-up sweep** runs in the API process. In development an API restart discards a test run whose view is still open; the view then shows that the run no longer exists.
- **A crash between creating the hidden chat and recording the run** leaves an empty `crew` chat, which the daily empty-chat prune removes; its worktree row loses its chat and the worker's worktree sweep releases it.

### Unverified

- **No real agent ran a test run.** Every test uses the fake ACP agent (database tests) or the echo provider (browser spec). Whether a real Claude or Codex step reads the held refusal and reports instead of retrying is untested; `pnpm test:live` was not run.
- **A waiting card answered from the view** is covered by a unit test of the options and by the view code only: neither fake agent has a non-sending command that asks, so no test raises a card inside a test run.
- **Spark tools from a real provider session inside a step** (an Ask session): held by `callSparkTool`, tested with the fake agent calling the MCP endpoint directly. Ticket, Confluence, Slack, calendar and browser holds are covered by unit tests of `heldTool` and `heldInTestRun`, not end to end: those tools need a connection the database tests don't have.
- **Dependency preparation in the copy** (`prepareDependencies`) was not exercised; the test repositories have no `node_modules`. With a large project the start request waits for it.
- **`pagehide`** (closing the window) was not tested; leaving the view and Discard were.
- **The Mac app** (Electron) and VoiceOver were not tried; Chromium through Playwright with axe only.
- **What ran (2026-11-13):** `pnpm check` passed. `pnpm test:changed` passed. `pnpm test:db:changed` had 63 failures in 28 files, almost all 20-second timeouts while other streams loaded the machine; the 28 files passed when rerun alone (270 tests), and `crew-test-run.db.test.ts` passes (12 tests). `pnpm test:browser:changed` selects nearly every spec (the change touches `workflow/` and the gate); the full set was not run. These were run and pass: `crew-test-run`, `crew-flows`, `sparks-page`, `sparks`, `spark-actions`, `spark-mention`, `approvals`, `attention-sync`, `sidebar-attention`, `island-states`, `browser-agent`, `rail-flags`. `crew-flows.spec.ts` now looks up **Run** with `exact: true`, since **Test run** also matched.
- **Found on the way, not changed:** `publishScope` has no step check, so an ordinary step in Auto or Bypass permissions is offered `spark_push` (the stream D text says it is not); `.wf-bar` in `workflow-editor.css` shares its name with `audit/audit-views.css`, whose `.wf-bar span` rule turns spans white when both are loaded.

## Stream H: builder chat (built, 2026-11-13)

Code is in `apps/server/src/crew-flows/builder-chat.ts` and `builder-drafts.ts`, `apps/web/src/sparks-page/BuilderDock.tsx`, `BuilderDrafts.tsx`, `builder-api.ts` and `builder.css`, and the corner companion (`apps/web/src/companion/`). Migration `0250_builder_chats.sql`. Tests: `apps/server/test/crew-builder-chat.db.test.ts`, `tests/browser/crew-builder.spec.ts` (group `sparks`). Guide: `docs/guide/build-with-an-agent.md`.

### Decisions

| Topic                  | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marker                 | `conversations.kind = 'crew'` (shared with test runs) plus a `crew_builder_chats` row (`conversation_id`, `workspace_id`, `created_at`, `done_at`, `removed_at`). Test-run code reaches its chats only through `workflow_runs`, and the step and hold logic reads `route.spark.test`, so a builder chat is an ordinary chat turn in every other way.                                                                                                                                                                                          |
| One session, provider  | The dock renders the ordinary `ChatView` in a `ChatPaneContext` (`landmark: 'section'`, name **Builder chat**, `split: true` so the Work panel opens as a sheet). The composer's provider and model picker is the picker; switching provider is the existing hand-off, a new session.                                                                                                                                                                                                                                                         |
| What the agent is told | `chatPromptFacts` sets `builderChat` from the row and `chatPrompt` adds a **Builder chat** section: what the page is, read with `spark_crew`, propose every change with `spark_crew_edit`, write nothing with other tools. `tool-offer.ts` needed no change: both tools are offered to any typed chat turn on the Mac that is not read-only (a read-only turn gets `spark_crew` only).                                                                                                                                                        |
| Done and reopen        | `POST /api/crew/builder/:id/done` sets `done_at` only when the chat is not already done, so a second Done keeps the first time. "Done" is derived, not stored: `done_at` is set and no user message (`role = 'user'`) is newer and nothing is queued. A new message therefore reopens the chat with no hook in the send path; the agent's own reply never does.                                                                                                                                                                               |
| Removal                | `sweepBuilderChats` runs in `pruneOldRows` (at API start and hourly). Due: done more than 24 hours ago with no turn queued or running, or, not done, quiet for the **Archive inactive chats** period (`LAST_ACTIVITY` and the busy, queued and waiting-card rules exported from `inactive-chats.ts`; **Never** keeps them). A due chat is stopped, its pending cards set to `expired`, its chat folder deleted and `removed_at` set.                                                                                                          |
| Audit stays            | Audit entries are `run_protocol_log` rows that cascade from `runs`, which cascade from the chat, and the audit is read per chat. To keep "the audit entries stay", a removed builder chat keeps its hidden conversation, messages and runs until audit retention has pruned every log row of its runs; the same sweep then deletes it with test-run's `removeChat`. The page and the dock never show a removed chat. **Confirmed by the owner (2026-11-13):** keep the audit; the transcript stays in the database until retention prunes it. |
| After Done             | The button opens the latest builder chat that is not removed: a done one shows "Done · removed tomorrow at …" and **New chat**; typing in it reopens it.                                                                                                                                                                                                                                                                                                                                                                                      |
| Drafts                 | `GET /api/crew/drafts`: pending `spark_action` cards in the workspace's unarchived chats that create a Spark (`create_teammate`) or a workflow (`crew_edit` on a workflow whose every file is `new`). A changed Spark or workflow is not a draft. Shown above the tabs as "Spark · Draft · waiting for you" with **Review**: the builder dock when the card is in a builder chat, the chat otherwise. Polled (4 s with the dock open, 30 s without).                                                                                          |
| Companion              | The corner companion is the in-app status companion (`StatusCompanion`, bottom right by default). Its panel has **Build a Spark or workflow**, which opens the Sparks page with the dock through `openBuilderChat()` in `sparks-route.ts`. Spark Island (the desktop window) is unchanged.                                                                                                                                                                                                                                                    |
| Paired devices         | The four routes are in `route-rules.ts` `NEVER`; the page hides the button and drafts and the companion has no entry when `remote`. A device that knew a builder chat's id could still reach it through the ordinary conversation routes, as with test-run chats; its turns would not get `spark_crew_edit` (device runs are refused).                                                                                                                                                                                                        |

### Routes added (all `never` for a paired device)

| Method and path                   | Body and result                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/crew/builder`           | `{ chat: BuilderChat \| null }`, the latest builder chat not removed, or `?id=` one (404 when removed), which **Review** uses for a draft in an older builder chat |
| `POST /api/crew/builder`          | `{ id }` → 201 `BuilderChat`; the same id again returns it; an ordinary chat's id is a 409                                                                         |
| `POST /api/crew/builder/:id/done` | `BuilderChat` with `doneAt` and `removeAt`; 404 when removed or unknown                                                                                            |
| `GET /api/crew/drafts`            | `{ drafts: CrewDraft[] }`                                                                                                                                          |

### Unverified

- **No real agent ran in a builder chat.** The database test checks the prompt section and that both crew tools are offered; the browser spec uses the echo provider. Whether a real agent drafts through `spark_crew_edit` from this prompt is untested; `pnpm test:live` was not run.
- **The draft row in the browser** comes from a faked `/api/crew/drafts`; the query itself is covered by the database test with seeded cards.
- **Provider switch in the dock** was not exercised; it is the chat's existing hand-off.
- **The Mac app** (Electron) and VoiceOver were not tried; Chromium through Playwright with axe on the dock only.
- **What ran (2026-11-13):** `pnpm check` passed (first run caught a unit test that mocks the prompt's lookups; fixed). `pnpm test:db:changed` and `pnpm test:browser:changed` select every test (the local `main` is 393 files behind; migrations and the fake agent count as run-everything), so they were not run to the end. Run instead: 16 database files (`crew-builder-chat`, `archive-inactive`, `attention-items`, `startup-prune`, `migrate-startup`, every `crew-*` and `spark-crew-*`, `stored-crew-turn`; 143 passed) and the browser specs `crew-builder`, `sparks-page`, `companion`, `crew-test-run`, `spark-crew-edit`, `sparks`, `crew-flows` (42 passed after `companion.spec.ts` was changed: the panel focuses its first button, which is now **Build a Spark or workflow**).

## Rules for every stream

- Follow `AGENTS.md`: no explanatory code comments, files at or below 500 lines, validate inputs at trust boundaries, no speculative configuration.
- Text never under 12px; status is an icon plus a word; every action reachable by keyboard; Apple's guidelines win on the Mac shell.
- Paired devices: reading the Sparks page and a run's status as text is allowed; creating, editing, running, scheduling and the builder chat stay on the Mac unless a later decision adds a rule in `route-rules.ts`.
- Each stream updates the guide page for what it changes and adds its `docs/guide/whats-new.md` row. A new browser spec goes in `tests/browser/spec-map.ts`.
- `AGENTS.md` is updated once, in an integration pass after Wave 2, not by each stream.
- Before merging: `pnpm check` and the changed-test commands. Execution and storage streams (A, D, F, G, H) cover cancel, restart recovery, duplicate requests and failure. Features that run real agents are tested with a real Claude chat and the results reported.

## Stream A: Spark folder storage (built)

Code is in `apps/server/src/crew/` and `apps/server/src/approvals/crew-folders.ts`. Details of the data model are in `TEAMMATES.md`.

### Decisions

- **The folder is named by the Spark's id**, `<data>/<channel>/sparks/<spark id>/`, not by a slug of its name. A rename then moves nothing and cannot lose files, two names that slug alike cannot collide, and the path an agent was told stays valid. `SPARK_CREW_DIR` (absolute) replaces the `sparks` folder in tests, as `SPARK_RULES_FILE` does for the rules file; `SPARK_WORKFLOWS_DIR` is honoured for the workflows folder, the same variable stream D's store reads.
- **`teammates.instructions` stays as an emptied column.** Migration `0246` adds `teammates.instructions_moved_at`. At API start, after migrations, `moveInstructionsToFolders` writes each unmoved Spark's text to `SPARK.md` (only when that file is not there yet), then empties the column and sets the mark in one statement. A second run finds nothing to do; a stop between the write and the mark is finished by the next start; a Spark whose folder cannot be written keeps its text in the column and is read from there until a later start moves it. The column cannot be dropped in `0246` because SQL migrations run before the files are written; a later migration can drop it once every install has started on this version.
- **`instructions_path` is unchanged.** A Spark that points at an external file is still briefed from that file (first 2,000 characters, as before), and falls back to `SPARK.md` when the file is missing, unreadable or empty. Its typed text is moved to `SPARK.md` like any other.
- **The `instructions` field of the teammate API is `SPARK.md`.** `GET /api/teammates`, `POST` and `PATCH` read and write the file, so the current edit sheet, `spark_create_spark` and `spark_update_spark` keep working. The field's limit is now the file limit (256 KB); `TEAMMATE_INSTRUCTIONS_MAX` remains only for the external file's cut and the old sheet's own counter, which stream B replaces.
- **A skill's `name` must equal its folder name.** Otherwise the skill is left out and listed under `problems`.
- **What a turn may read.** Every chat turn may read the whole `sparks` and `workflows` folders (Claude's readable directories and the gate's readable list; Codex's sandbox already reads them), so an agent can spot an existing Spark or skill before making a duplicate (owner's decision, 2026-11-13). A turn linked to a Spark may also run scripts from its own folder. Changes stay refused in every mode.

### Routes (final)

All four are Mac only (`never` in `route-rules.ts`); a paired device gets 403. Errors are `{ error: string }`.

| Method and path                         | Body / result                                                                                                                                                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/teammates/:id/folder`         | `sparkFolderSchema`. An empty folder for a Spark with no files. 404 for an unknown Spark.                                                                                                                                                                  |
| `GET /api/teammates/:id/files?path=`    | `crewFileSchema`. 404 when the file is missing; 400 for a bad path, a folder, a file over 256 KB or one that is not UTF-8.                                                                                                                                 |
| `PUT /api/teammates/:id/files`          | `saveCrewFileSchema` → `crewFileSchema` (200). `baseHash: null` creates and answers 409 when the file exists; otherwise 409 when the file changed or was deleted since `baseHash`. 400 for a bad path, text over 256 KB, a NUL character, or a 201st file. |
| `DELETE /api/teammates/:id/files?path=` | 204. 404 when missing. Folders left empty are removed.                                                                                                                                                                                                     |

`hash` is the SHA-256 of the text in hex. `SPARK.md` is an ordinary file on these routes; deleting it empties the instructions. `PUT` and `DELETE` close the Spark's chats' provider sessions, so the next turn gets the new brief. `DELETE /api/teammates/:id` deletes the folder; folders whose Spark is gone (a reset) are removed by the hourly prune. JSON bodies on `/api/teammates…` may be up to 2 MB so a full-size file fits after escaping.

### The brief

`sparkBrief` (`crew/spark-brief.ts`) builds the brief for a Spark's chat and for a `spark` child run: instructions from `SPARK.md` (or the external file), then one line per skill with its name, description and the absolute path of its folder, and a sentence saying the folders are read-only. Claude gets it in the appended system prompt, Codex in developer instructions.

### Reading open, writing shut

| Layer  | Read of the turn's own Spark folder                                                                                                                                           | Change to `sparks/` or `workflows/`                                                                                                                                                                                                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate   | `ApprovalRequest.readable` holds the folder: the read tool is not refused, and a command that only reads there runs at once. A script run from it is judged like any command. | `changesCrewFolders` refuses in every mode, before any rule: edit, delete and move tools; redirects, `rm`, `mv`, `cp` into, `sed -i`, `tee`, `touch`, `mkdir`, `ln`, `chmod`, inline code and any other program that is not a read or a run of a script from the folder; a delete or move of a parent folder. |
| Claude | The folder is added to `permissions.additionalDirectories` of the session.                                                                                                    | `Edit(//<folder>)` and `Edit(//<folder>/**)` deny rules for both folders in every session, Bypass permissions included.                                                                                                                                                                                       |
| Codex  | Both folders are marked `read` in every permission profile.                                                                                                                   | The same `read` entries make them read-only under `:root = write` (Full access).                                                                                                                                                                                                                              |

None of this depends on the user's rules file. The rest of Spark's data folder is as protected as before: tests cover the rules file, another chat's private folder and browser data, and that the crew folders are readable but never changed.

### Known limits

- **A script can write.** The gate reads the command line, not what the program does. A script an agent runs from a skill folder can change files, including the Spark's own folder, unless the provider's sandbox stops it (Codex's `read` entry does; Claude has no sandbox here).
- **Modes the gate cannot see.** In Claude Accept edits, Auto and Bypass permissions and Codex Workspace access, Auto review and Full access, a shell command does not reach the gate. There the protection is Claude's `Edit` deny rules, which Claude applies to its file tools and, as far as it recognises them, to shell file commands, and Codex's sandbox. No observed-rail flag is raised for a crew folder change that ran unseen; the rules file has none either.
- **Hand-off children have no shell today**, so a script can only run in a Spark's own chat until stream D's step kind is merged.
- **The old edit sheet** still counts to 2,000 characters on the client. It can show a longer `SPARK.md` but refuses to save it until stream B replaces the sheet.

### For integration

- `crew/folders.ts` and stream D's `crew-flows/workflow-store.ts` both resolve the workflows folder; keep one.
- The plan above allowed a paired device to read the Sparks page; these four routes are refused for one, as the stream A brief asked. Opening the read routes later is one line each in `route-rules.ts`.
- `AGENTS.md` needs the new fixed rule and the folder (not edited by this stream).

### Verified and not

Verified by tests: the store (path escapes, links, size and count limits, hash conflicts, non-UTF-8, delete), the move (repeat, half-done, unwritable folder, external file), the routes and their remote rules, the brief with and without skills, the gate's read allowance and write refusals, and the Claude and Codex configuration Spark builds. **Observed with a real Claude (2026-11-13, see "Found by the real-agent test"):** a step reads `SKILL.md` in its Spark's folder without a card, a script run from the folder is judged like any command, and Claude's `Edit` deny rules stop a write to `SPARK.md` in Bypass permissions, by the edit tool and by a shell redirect. **Not verified:** no real Codex run was made; that Codex accepts a `read` entry for an absolute path under `:root = write` is taken from how the rules file and temp folders are configured today, not observed.
