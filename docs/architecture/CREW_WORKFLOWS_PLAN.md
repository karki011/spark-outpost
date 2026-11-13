# Crew and workflows: build plan

> **Status: Wave 0 (shared contracts) and stream A (Spark folder storage) built.** Agreed in a planning session on 2026-11-12. This changes `docs/product/PLAN.md` §17, which defers "a visual workflow builder": the owner has asked for it. That line is updated.

Mocks for every screen: `docs/design/mocks/crew-workflows-mock.html` (15 screens, ids `g h i d j k a b l m c f e n o` in flow order). They are sketches, not built from app components.

## What we are building

1. **A Sparks page** in the left bar with two tabs, **Crew** and **Workflows**. Sparks leave Settings; the Home roster stays.
2. **A Spark is a folder.** The form is the default; a Spark gains skills (instructions plus scripts) only when it needs them.
3. **A workflow** combines Sparks into steps that run in order or side by side.
4. **Three ways to try and run:** Preview (no agents), Test run (real agents, thrown away), Run (by hand, `@name` in a chat, or on a schedule).
5. **Agents can build and edit** Sparks, skills and workflows, only through a card the user allows.
6. **A builder chat** docked on the Sparks page for creating them by talking to an agent.

## Decisions made

| Topic                       | Decision                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage                     | `<data>/<channel>/sparks/<spark>/` and `<data>/<channel>/workflows/<id>.json` (JSON, so no YAML dependency is added; users edit through the page, agents through tools). Spark the app reads, writes and deletes them.                                                                                        |
| One owner per piece         | The database keeps a Spark's identity (id, name, look, default provider, model, mode, level, projects) and all run history. The folder owns instructions, skills and scripts. Workflow definitions are files.                                                                                                 |
| Spark folder                | `SPARK.md` (instructions), `skills/<skill>/SKILL.md` with `name` and `description` frontmatter, any other files beside it. The 2,000-character instruction limit goes away.                                                                                                                                   |
| Skill loading               | The Spark's brief lists each skill's name and description; the agent reads the files when it needs them. No dependency on a provider's own skill loader.                                                                                                                                                      |
| Agent edits                 | Only through Spark tools, each change a card showing before and after, in every mode. Answered by the user on the Mac only; never by Ask Spark or a paired device. Checked against the file's hash before writing. Audited.                                                                                   |
| Direct writes               | The agent's own file and shell tools are denied writing to the crew and workflow folders, in every mode, the way the rules file is protected. Reading is allowed.                                                                                                                                             |
| Where the tools are offered | Every chat turn on the Mac. Not to a run from a paired device, a spoken run, a child run, or a Spark working a workflow step.                                                                                                                                                                                 |
| Workflow shape              | Steps with `spark`, optional `prompt`, `dependsOn` (several parents), `join` (`all` or `any`), `onFailure` (`stop` or `continue`). No loops. Checked on save: no cycles, every Spark exists.                                                                                                                  |
| Step outputs                | Each step's output is a note passed to the steps that depend on it. No shared state.                                                                                                                                                                                                                          |
| Authority                   | Nothing a workflow or schedule writes is the user's message. It never authorises a push, a pull request or a Spark action; the chat's own mode and level decide.                                                                                                                                              |
| Limits                      | No caps, budgets or timers. Time, tokens and cost are measured and shown. A schedule shows an estimate.                                                                                                                                                                                                       |
| Preview                     | Pure function over the workflow file. No agents, no cost. "Pretend this step fails" per step.                                                                                                                                                                                                                 |
| Test run                    | Real agents on a temporary worktree. Sends off the computer are refused and listed as "would have been sent". The copy and the run are deleted when the view closes. Cost is real and counted. Also offered for one Spark ("Try it").                                                                         |
| Schedule                    | "Every N minutes, hours, days or weeks", optional days and hours window, project, message. Missed while asleep or closed: run once when back (default) or skip, never once per missed slot. Previous run still going: skip and say so. Spark pause holds it. Finished runs are updates, grouped per schedule. |
| Builder chat                | An ordinary hidden chat docked on the Sparks page: one agent session from first message to Done, default provider with a picker (a different provider is a new session). Drafts show on the page as "Draft · waiting for you".                                                                                |
| Builder chat cleanup        | Done marks it done with no dialog. Deleted 24 hours later without asking (or at next start if Spark was closed). A new message within 24 hours reopens it. One left without Done is deleted after the **Archive inactive chats** period. The Spark, its files and the audit entries stay.                     |
| Editor                      | List editor with a live graph preview first. Canvas drag editing later, on the same file.                                                                                                                                                                                                                     |

## Assumed, not yet confirmed by the owner

- **A workflow step may run commands** in the Spark's own mode through the normal approval gate (scripts need this), but may not edit project files, push or open a pull request. Today a Spark handed a job is forced read-only.
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
| **D. Workflow engine**       | Run a workflow as one turn with a child run per step: parallel stages, `dependsOn`, `join`, `onFailure`, notes passed on, cancel, restart recovery, run records, Run route and `@workflow` mention, a step kind that may run commands through the gate (today's hand-off child has no shell) but not edit project files or publish | `apps/server/src/crew-flows/`, migration `0246`, `spark-handoff.ts`                  |
| **E. Workflow editor**       | Workflows tab, list, empty state, New workflow, list editor with live graph, Preview with pretend failures                                                                                                                                                                                                                         | `apps/web/src/crew-flows/`                                                           |

B and E build against the Wave 0 shapes with a fake API until A and D land.

### Wave 2 (four in parallel)

| Stream                       | Scope                                                                                                                                                                                                                       | Needs               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **C. Agent tools and cards** | `spark_crew` (read) and `spark_crew_edit` (Sparks, skills, files, workflows) with the before-and-after card, Mac only, hash check, audit; keep the tool budget test passing; guide reference page read through `spark_docs` | A                   |
| **F. Test run**              | Temporary worktree, refuse and list sends, cleanup on close and at startup, "Try it" for one Spark                                                                                                                          | D                   |
| **G. Schedules**             | Scheduler, schedule table, catch-up, skip on overlap, pause, Schedule tab, run history, estimate line, grouped Updates line                                                                                                 | D, migration `0247` |
| **E2. Run view**             | Live status on the graph, step output panel, time, tokens and cost line, Stop                                                                                                                                               | D, E                |

### Wave 3

| Stream                | Scope                                                                                                                                                                                 | Needs               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **H. Builder chat**   | A `conversations.kind` value for builder chats, dock on the Sparks page, provider picker, drafts on the page, Done, delete after 24 hours, cleanup of abandoned ones, companion entry | C, migration `0248` |
| **I. Canvas editing** | Drag Sparks, draw connections, step inspector, Tidy up, keyboard path for every action                                                                                                | E                   |

### Later, not planned in detail

- Steps that change code, push or open pull requests, through outposts (needs several parents per story task).
- Conditions on a step ("only if Security found something", "stop early when nothing is new").
- Starting a workflow on an event, such as a chat opening a pull request.

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
- **What a turn may read.** A turn linked to a Spark (its chat, an `@Spark` hand-off child, and a workflow step child, which is a `spark` child run) may read that Spark's own folder and run scripts from it. It gets no allowance for other Sparks' folders or for the workflows folder: nothing needs them today (stream C's tools read through Spark, not the file system), so they stay as closed as any path outside the project. The allowance does not depend on where the run was started.

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

None of this depends on the user's rules file. The rest of Spark's data folder is as protected as before: tests cover the rules file, another chat's private folder, another Spark's folder, the workflows folder and browser data.

### Known limits

- **A script can write.** The gate reads the command line, not what the program does. A script an agent runs from a skill folder can change files, including the Spark's own folder, unless the provider's sandbox stops it (Codex's `read` entry does; Claude has no sandbox here).
- **Modes the gate cannot see.** In Claude Accept edits, Auto and Bypass permissions and Codex Workspace access, Auto review and Full access, a shell command does not reach the gate. There the protection is Claude's `Edit` deny rules, which Claude applies to its file tools and, as far as it recognises them, to shell file commands, and Codex's sandbox. No observed-rail flag is raised for a crew folder change that ran unseen; the rules file has none either.
- **Codex reads more than its own Spark.** Codex's sandbox entry covers the whole `sparks` folder, so Codex can read another Spark's folder with a shell command in a mode that runs it; the gate's allowance is still per Spark.
- **Hand-off children have no shell today**, so a script can only run in a Spark's own chat until stream D's step kind is merged.
- **The old edit sheet** still counts to 2,000 characters on the client. It can show a longer `SPARK.md` but refuses to save it until stream B replaces the sheet.

### For integration

- `crew/folders.ts` and stream D's `crew-flows/workflow-store.ts` both resolve the workflows folder; keep one.
- The plan above allowed a paired device to read the Sparks page; these four routes are refused for one, as the stream A brief asked. Opening the read routes later is one line each in `route-rules.ts`.
- `AGENTS.md` needs the new fixed rule and the folder (not edited by this stream).

### Verified and not

Verified by tests: the store (path escapes, links, size and count limits, hash conflicts, non-UTF-8, delete), the move (repeat, half-done, unwritable folder, external file), the routes and their remote rules, the brief with and without skills, the gate's read allowance and write refusals, and the Claude and Codex configuration Spark builds. **Not verified:** no real Claude or Codex run was made. That Claude honours `additionalDirectories` for reads of the folder, that its `Edit` deny rules stop writes there in Bypass permissions, and that Codex accepts a `read` entry for an absolute path under `:root = write` are taken from how the rules file and temp folders are configured today, not observed.
