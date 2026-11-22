# Sparks: named teammates

A Spark (code name: teammate) is a named, long-lived preset for chats. It owns no execution: a teammate chat runs exactly like any other chat. A teammate only supplies defaults when a chat starts and standing instructions on every main-session turn.

## Data (migration 0095)

- `teammates`: workspace, `name` (unique per workspace, case-insensitive, 1–40), `role` (≤60), `face_shape` and `face_color` (one of `TEAMMATE_SHAPES` and `TEAMMATE_COLORS`, or both null for a blob that follows the name; migration 0112), default `provider`, `model`, `agent_mode`, `level`, `instructions` (emptied once moved to the folder; see [The Spark's folder](#the-sparks-folder-migration-0246)), `instructions_moved_at` (migration 0246), `instructions_path` (optional file read at chat start; migration 0112), `home_conversation_id` (`ON DELETE SET NULL`), timestamps. Up to 50 per workspace.
- `teammate_projects`: default projects in order; rows go with the teammate or the project.
- `conversations.teammate_id` (`ON DELETE SET NULL`): deleting a teammate unlinks its chats and keeps them.
- `profiles.dismissed_teammate_starters`: starter suggestions the user dismissed.
- `profiles.default_teammate_id` (`ON DELETE SET NULL`, migration 0273): the one Spark new chats start as, or null for none. See [The Spark for new chats](#the-spark-for-new-chats-migration-0273).
- `chat_notes` (migration 0273): one-line notes in a chat's transcript (`kind = 'spark_settings'`, the Spark's name at the time, `at`). Rows go with the chat.
- A trigger on `teammates` sends a `teammate` app event, so open windows refresh the roster.

## The Spark's folder (migration 0246)

A Spark's instructions, skills and scripts are files in `<data>/<channel>/sparks/<spark id>/` (`apps/server/src/crew/`); the database keeps its identity and defaults. The folder is named by the id, so a rename moves nothing. `SPARK_CREW_DIR` replaces the `sparks` folder in tests.

- `SPARK.md` is the instructions. The `instructions` field of the teammate API reads and writes this file, so it has the file limit (256 KB), not 2,000 characters. An empty text deletes the file.
- `skills/<skill>/SKILL.md` starts with `name` and `description` between `---` lines (`parseSkillFile`); the name must equal the folder name. Other files sit beside it.
- Limits: 200 files, 256 KB each, UTF-8 text with no NUL, paths that pass `crewPathProblem`. No link inside the folder is followed, and a file's real path is checked again after it is resolved. Saves are written to a temporary file and renamed; writes in the API process run one at a time.
- `moveInstructionsToFolders` runs at API start: for each Spark with `instructions_moved_at` null it writes the column's text to `SPARK.md` unless the file exists, then empties the column and sets the mark. Until a row is moved, readers use the file when there is one and the column otherwise.
- Deleting a Spark deletes its folder; the hourly prune removes folders whose Spark is gone.
- Agents read the folder of the Spark their turn is linked to and run scripts from it. No agent tool or shell command may change, move or delete anything under `sparks/` or `workflows/`, in any mode. How that is enforced, the decisions and the limits are in `CREW_WORKFLOWS_PLAN.md`, stream A.

## Faces

`faceFromName` (contracts) hashes the trimmed, lower-cased name (FNV-1a) into a shape and a colour, so a Spark gets a stable face without the user picking one. The server resolves it: `face` on a teammate or a conversation's teammate tag is always the stored pick or, when none is stored, `faceFromName(name)`, and `faceAuto` says which. Every surface renders `face`, so the name-based blob is the same everywhere and follows a rename. The sheet hides the pickers behind **Change look**; **Use name** stores null again. The web maps a face to a Blobatar: the shape pins the `shape` trait to the middle of its band, the colour fixes the hue, and the tone is fixed at 0.5 so all Sparks sit at the same weight. State maps to the existing blob expressions (working → thinking, needs you → unsure, done → happy, failed → sad); faces animate only while working or waiting, and never with reduced motion.

## State

`teammateState` (contracts, pure) folds the latest top-level run of each non-archived linked chat: any pending card or `awaiting_approval` → `needs_you`; any `queued`/`running` → `working`; otherwise the most recently finished run decides: `failed`/`outcome_unknown` within 24 hours → `failed`, `succeeded` within an hour → `done`, else `idle`. The server computes it in `teammateList` so every reader (web, Spark tools, the island later) agrees.

## Chats

- **Start with a teammate** (`PUT /api/conversations/:id/teammate`): creates the conversation if needed, refuses once it has a message, links it, and applies the teammate's provider, model, mode and autonomy through `updateChatSettings` (falling back to autonomy only if the provider is gone or no longer offers the mode) and its projects through `setConversationProjects`. `teammateId: null` returns a draft to a plain chat.
- **Home thread** (`POST /api/teammates/:id/home`): returns the teammate's home conversation, creating it (titled with the teammate's name, `title_source = 'user'`) the first time or after it was deleted or pruned.
- Conversation summaries carry an optional `teammate` tag (id, name, role, face) for the header, sidebar rows and the `with:` filter.

## The Spark for new chats (migration 0273)

**Use for new chats** on a Spark's page stores that Spark in `profiles.default_teammate_id` (`PUT /api/teammate-default`, Mac only). At most one Spark holds it; turning it on for another replaces it, turning it off stores null, and deleting the Spark clears it.

- The composer's context bar (`useDefaultSpark` in `apps/web/src/teammates/use-default-spark.ts`, called from `ContextBar`) asks once per chat it shows with no message and no Spark: `POST /api/conversations/:id/default-teammate`. That is the same place **Talk to…** is shown, so the default is only ever applied where the user can see and change it.
- `startWithDefaultTeammate` inserts the conversation row and links it with `attach`, exactly as `linkChat` does, only when the row did not exist. A chat that already has a row is returned as it is, so the user's own **No Spark** or other Spark, a chat started in a project, a sub-chat, a workflow chat and a chat a ticket or Slack started are never changed.
- The context bar is not shown in Ask Spark's chat, crew and builder chats, meeting chats or the Terminal composer, so none of them ask. A new chat that the user switches to a Terminal session before its first message loses the link and the Spark's settings (`applyConversationOptions`).
- Home's composer carries the last chat's settings to the next draft only when that chat had no Spark, so after a chat with the default Spark the next draft is new and gets the default again; after **No Spark** the next draft stays plain.
- The island's quick new chat does not show **Talk to…** and does not use the default.

## Chats follow their Spark's agent settings

`followTeammateSettings` (`persistence/teammate-chats.ts`) runs after every Spark update, from the page (`PATCH /api/teammates/:id`) and from an agent's `spark_update_spark`. When the update names `provider`, `model`, `effort` or `agentMode` (`TEAMMATE_FOLLOWED_FIELDS`), each linked chat that is not archived and has no run that is `queued`, `running` or `awaiting_approval` gets the Spark's four values through `updateChatSettings` (or, for a Spark set back to **Default**, loses its own provider, model, effort and mode and keeps its autonomy and options), its open provider sessions are closed with the reason `settings changed`, and a chat with at least one message gets a `chat_notes` row. The chat's autonomy level and projects are never touched.

- Kept simple on purpose: a chat whose user picked another model or mode by hand after linking follows the Spark too. There is no per-chat "pinned" mark.
- A chat skipped because a turn was running keeps its old settings until the Spark is saved again; nothing retries.
- A chat whose provider is no longer connected, or does not offer the mode, is left as it was and gets no note.
- The note is read with the chat (`conversationTopics`, the `topics` list of the chat detail, kind `spark_settings`) and shown by `Thread` as a divider line placed by time: "Pip's settings changed. This chat now uses them. · today" (`sparkSettingsLine`).

## Where a Spark is used

`GET /api/teammates/:id/usage` (`persistence/spark-usage.ts`, Mac only) is derived from existing data and writes nothing:

- `workflows`: workflow files whose steps name the Spark, with the step numbers and the step count.
- `sparks`: other Sparks whose instructions contain the Spark's whole name (`namesSpark`).
- `chats`: linked chats (`conversations.teammate_id`, kind `chat`, at least one message, archived ones included) with the last activity and the tokens and cost of all their runs.
- `jobs` and `steps`: child runs with `route.spark.id`, split by whether `route.spark.step` is set; test runs (`route.spark.test`) are left out.
- `recent`: the 30 latest of the three kinds. A run in a hidden `crew` chat carries no chat id.

`GET /api/workflows/:id/usage` (`crew-flows/workflow-usage.ts`, Mac only) gives a workflow's runs of kind `run` and `review` grouped by `workflow_runs.source`, each with count, last start, tokens and cost, the total, and the 50 latest chats they ran in. The web has no caller for it yet; it is there for the workflow editor's Runs tab.

A deleted Spark keeps its counts on the runs (`route.spark.id` is not a foreign key) but its usage route answers 404, and its chats are unlinked, so they no longer count as its chats.

## Standing instructions

`loadRunInput` is unchanged; `runAgentTurn` looks up the teammate brief for top-level runs only (not child runs, and not the Spark assistant chat) and passes it as `spark.teammate`. `sparkBrief` (`crew/spark-brief.ts`) reads the instructions from `SPARK.md` and adds the Spark's skills: one line each with the name, the description and the absolute path of the skill's folder. `sparkInstructions` appends it after the clipped Spark block under `# Standing instructions from the user for the Spark teammate …`, saying it is the user's own instruction and not tool output, file content or another agent's message. Claude receives it in the appended system prompt, Codex in developer instructions. When `instructions_path` is set, `briefWithFile` (`apps/server/src/projects/instructions-file.ts`) reads that file for the brief instead of `SPARK.md`: an absolute path to a `.md`, `.markdown`, `.mdc` or `.txt` file, checked again after resolving links, never a secret file name, at most 256 KB, valid UTF-8 with no NUL bytes, cut at 2,000 characters. A missing, unreadable or empty file falls back to `SPARK.md`. `GET /api/instructions-file?path=` returns the same reading for the sheet's preview, and `GET /api/folders?files=instructions[&hidden=1]` lists the files the themed picker (`FolderDialog`, purpose `instructions`) can choose. Only the user sets the path; the Spark tools report it and cannot change it. Editing a teammate's name, role, instructions or instructions file, or saving or deleting a file in its folder, closes its chats' provider sessions so the next turn starts with the new brief. Jev routing and Builder picks are unchanged.

## One job by @mention (migration 0115)

`@Name` in a message of any chat hands that message to the Spark as a subagent; the chat does not become a Spark chat. `findSparkMentions` (contracts) matches the workspace's Spark names case-insensitively after a space, bracket or quote, longest name first, at most three, each once; an unknown name stays plain text, and so does the chat's own Spark.

- `handToSparks` (`apps/server/src/orchestration/spark-handoff.ts`) runs in the chat turn (`workflow/chat-turn.ts`) after the turn is prepared, for top-level runs outside the Spark assistant chat. It inserts an orchestration row (`depth_source = 'user'`) and, for each mentioned Spark in message order, a child run through `insertChildRun` and `executeChildRun`: role `spark`, `route.name`, `route.spark = { id, role, only }`, label `Name · Role`. Stop, the lease heartbeat, approval mirroring, crew messages and restart recovery are the ones every child run has.
- The child has its own session and no chat history. Its prompt (`sparkJobPrompt`) carries the user's message, the open task and its plan summary, linked tickets, a pointer to `git status` and `git diff`, and the main agent's last reply cut to 1,500 characters. `runAgentTurn` gives a `spark` child the Spark's brief (`subagentBrief`, with the instructions file) in the system prompt and writes a `spark/handoff` audit entry on the child run.
- Provider, model, effort and agent mode come from `sparkRunSettings` (`orchestration/spark-settings.ts`), as for a workflow step: the Spark's own values always win (its provider when connected), and a Spark on **Default** takes the chat's provider, model, effort and agent mode, the mode translated (`translateMode`) when the Spark names another provider. The chat's mode is read from the turn's run (`runPlace` in `spark-child.ts`, the one place to switch to the live mode). The run mode is always `ask` (or `chat` without a project): the subagent reads and cannot change files, push or open PRs, whatever the mode is; the mode decides only whether its reads and other commands ask. The Spark's autonomy is not applied: `insertChildRun` takes the level explicitly and a Spark child always gets `hands-off` (`SPARK_CHILD_LEVEL`), never the chat's. A `role = 'spark'` child run is never the user's message for a push, a pull request, a Spark action or a rules session grant, even when the user typed the turn it belongs to. `route.spark.origin` records where the mention came from (`typed_mac` for a turn typed on the Mac, `other` for a paired device, a ticket, Slack, another chat or a follow-up round; `orchestration/typed-on-mac.ts`); it changes nothing yet. `route.spark` records `agentMode`, `agentFrom` and `modeFrom` (`spark`, `chat` or `default`) for the block's header.
- `mainAgentContinues` decides what follows. A message that opens with its mentions and has no hand-back word (`then`, `after that`, `once it is done`…) is for the Sparks only: the turn ends with the hand-off note as the assistant message and the main agent does not run. Otherwise the turn continues as usual with the note appended to the prompt only (`withHandoffNote`): the request stays the user's own words, so a Spark's reply is never read as the user asking to publish.
- `handoffNote` holds each Spark's reply cut to a share of 1,200 characters and points at `spark_chat` (`sparkReplies`) for the full text. The Spark's reply is not stored in `messages`, so it never enters the main agent's history; the web reads it from the child run's events.
- Cost and tokens are on the child run and count in the turn's and the chat's totals. Deleting the Spark keeps the name and role on the run.

Web: `suggestSpark` (`apps/web/src/teammates/spark-match.ts`) offers one chip, **Ask Pip (Code reviewer)?**, in the context bar when the draft matches a Spark's name (3 points), its role's concept group such as review, docs, bug, test (2), or a significant role word (1), at 2 points or more; ties go to the earliest matching word. A role with no known concept falls back to the first concept word of the instructions. One-word drafts, slash commands and drafts with a mention get no chip; a dismissed chip stays away until the draft is emptied. The `@` picker lists every Spark and every saved workflow above project files, with no cap, each row tagged **Spark** or **Workflow** with an icon. It asks for the workflow list again each time it opens, so a workflow an agent just saved is there. A workflow with problems, or one whose id is a Spark's name, is listed, marked and cannot be picked (`mentionBlock`). Workflow routes are Mac only, so a paired device's picker lists Sparks and files. `TurnSection` shows **Handed to** tags on the user message and the Spark's block with its face, name and role; a turn only Sparks worked on shows no main agent block and hides the hand-off note.

Not built yet: a `spark_ask_spark` tool for the main agent to delegate, parallel mentions, and Sparks that change files.

### Sparks that change files: what is in place (not reachable yet)

- `sparkCapability` (`orchestration/spark-capability.ts`, pure) decides `read`, `work` or `sub_chat` for a handed job or a step, first match wins: a review or Before publish reads; no project reads; a mode that is read-only, Plan, denies or unknown reads; a Spark whose mode the user has not confirmed reads; a job that was not typed on the Mac (and is not a tool call or a step) reads; a Spark at Full auto → PR gets its own sub-chat for a typed or tool job outside a sub-chat, a test run and a step; a chat in the user's checkout reads; anything else works. `sparkWorkMark` (`orchestration/spark-work.ts`) gathers the facts for `@Name` and for a step and always passes `confirmed: false`, so every job still reads.
- `route.spark.work` marks a work run. The run row stays `ask`; `loadRunInput` reads it as `sparkWork` only on a `role = 'spark'` run in mode `ask`. `prepareSparkWorkRun` (`workflow/do-run.ts`) builds its gate: the Spark's own mode posture through the ordinary `decide` path (edits, moves, deletes, shell writes, installs and local commits follow the mode; the floor, Spark rules, `WriteOutside`, `--no-verify`, the crew folders and browser data hold), `changesProject` so the publish and `gh` rules apply, no publish grant, sends held in a test run, and `workRunRefusal` (`approvals/ask-run.ts`), which refuses a push, `git send-email` and `request-pull`, every hosting CLI command that is not a read, a remote change and a `git config` write in every mode. A mode that only reads falls back to the Ask gate. The agent's environment cannot push (`cannotPush`) and `publishScope` is null for a child run.
- Still to do before `confirmed` can be true: the Spark's confirmed-mode columns, the provider session that gives a work run edit tools, the kept record and snapshot for its changes, and the sub-chat path.

## API

| Method and path                                | Body / result                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /api/teammates`                           | `TeammateList`: teammates with state, chat count, last activity, starters still offered, `defaultTeammateId` |
| `POST /api/teammates`                          | `CreateTeammateRequest` → `Teammate` (400 on bad input or an unconnected provider, 409 on a duplicate name)  |
| `PATCH /api/teammates/:id`                     | `UpdateTeammateRequest` → `Teammate`                                                                         |
| `DELETE /api/teammates/:id`                    | 204; chats keep existing, unlinked; the Spark's folder is deleted                                            |
| `GET /api/teammates/:id/folder`                | `SparkFolder`: files, skills and skill problems (Mac only)                                                   |
| `GET /api/teammates/:id/files?path=`           | `CrewFile`: path, text, hash (Mac only)                                                                      |
| `PUT /api/teammates/:id/files`                 | `SaveCrewFile` → `CrewFile`; 409 when it exists (`baseHash` null) or changed since `baseHash` (Mac only)     |
| `DELETE /api/teammates/:id/files?path=`        | 204 (Mac only)                                                                                               |
| `POST /api/teammates/:id/home`                 | `TeammateChat` (`conversationId`, `teammate`)                                                                |
| `PUT /api/conversations/:id/teammate`          | `{ teammateId: uuid \| null }` → `TeammateChat`                                                              |
| `POST /api/teammate-starters/:starter/dismiss` | 204                                                                                                          |
| `PUT /api/teammate-default`                    | `{ teammateId: uuid \| null }` → the same; 404 for an unknown Spark (Mac only)                               |
| `POST /api/conversations/:id/default-teammate` | `TeammateChat`: links a chat that has no row yet to the default Spark; otherwise the chat as it is           |
| `GET /api/teammates/:id/usage`                 | `SparkUsage` (Mac only)                                                                                      |
| `GET /api/workflows/:id/usage`                 | `WorkflowUsage` (Mac only)                                                                                   |

Contracts live in `packages/contracts/src/teammates.ts` and, for the folder, `crew-files.ts`.

## Seam for the desktop island

The island is not wired yet. It can use the same contracts without new server work:

- Roster with blobs and state: `GET /api/teammates` (`teammateListSchema`), refreshed on `teammate`, `conversation`, `run` and `approval` app events. Render faces with the same `faceRender` mapping as `apps/web/src/teammates/face-style.ts`.
- "Talk to" in Quick chat: pick a teammate, then `PUT /api/conversations/:draftId/teammate` before sending the first message with the existing send call; or open its home thread with `POST /api/teammates/:id/home` and send there.

## UI

Home shows **Your Sparks** (cards, **New Spark**, starters when empty). The create/edit sheet reuses `ChoicePicker` with the provider defaults' model and mode choices, and deletes with `HoldToConfirm` plus a 10-second `GracePeriodBar`; nothing is sent until the grace period ends. **Talk to…** is a chip in the composer's context bar, after the project and the branch, on Home and in empty chats, shown inline whether or not a project is linked (it was inside the **…** details popover when one was); its menu uses the project menu's style and marks the Spark used for new chats. The Chats sidebar shows faces on rows and filter chips that write a `with:<name>` search token. Settings has a **Teammates** section (the Sparks list; **Spark** is the app-behaviour section). User guide: `docs/guide/sparks.md`.
