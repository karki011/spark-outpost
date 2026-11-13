# Sparks: named teammates

A Spark (code name: teammate) is a named, long-lived preset for chats. It owns no execution: a teammate chat runs exactly like any other chat. A teammate only supplies defaults when a chat starts and standing instructions on every main-session turn.

## Data (migration 0095)

- `teammates`: workspace, `name` (unique per workspace, case-insensitive, 1–40), `role` (≤60), `face_shape` and `face_color` (one of `TEAMMATE_SHAPES` and `TEAMMATE_COLORS`, or both null for a blob that follows the name; migration 0112), default `provider`, `model`, `agent_mode`, `level`, `instructions` (≤2000), `instructions_path` (optional file read at chat start; migration 0112), `home_conversation_id` (`ON DELETE SET NULL`), timestamps. Up to 50 per workspace.
- `teammate_projects`: default projects in order; rows go with the teammate or the project.
- `conversations.teammate_id` (`ON DELETE SET NULL`): deleting a teammate unlinks its chats and keeps them.
- `profiles.dismissed_teammate_starters`: starter suggestions the user dismissed.
- A trigger on `teammates` sends a `teammate` app event, so open windows refresh the roster.

## Faces

`faceFromName` (contracts) hashes the trimmed, lower-cased name (FNV-1a) into a shape and a colour, so a Spark gets a stable face without the user picking one. The server resolves it: `face` on a teammate or a conversation's teammate tag is always the stored pick or, when none is stored, `faceFromName(name)`, and `faceAuto` says which. Every surface renders `face`, so the name-based blob is the same everywhere and follows a rename. The sheet hides the pickers behind **Change look**; **Use name** stores null again. The web maps a face to a Blobatar: the shape pins the `shape` trait to the middle of its band, the colour fixes the hue, and the tone is fixed at 0.5 so all Sparks sit at the same weight. State maps to the existing blob expressions (working → thinking, needs you → unsure, done → happy, failed → sad); faces animate only while working or waiting, and never with reduced motion.

## State

`teammateState` (contracts, pure) folds the latest top-level run of each non-archived linked chat: any pending card or `awaiting_approval` → `needs_you`; any `queued`/`running` → `working`; otherwise the most recently finished run decides: `failed`/`outcome_unknown` within 24 hours → `failed`, `succeeded` within an hour → `done`, else `idle`. The server computes it in `teammateList` so every reader (web, Spark tools, the island later) agrees.

## Chats

- **Start with a teammate** (`PUT /api/conversations/:id/teammate`): creates the conversation if needed, refuses once it has a message, links it, and applies the teammate's provider, model, mode and autonomy through `updateChatSettings` (falling back to autonomy only if the provider is gone or no longer offers the mode) and its projects through `setConversationProjects`. `teammateId: null` returns a draft to a plain chat.
- **Home thread** (`POST /api/teammates/:id/home`): returns the teammate's home conversation, creating it (titled with the teammate's name, `title_source = 'user'`) the first time or after it was deleted or pruned.
- Conversation summaries carry an optional `teammate` tag (id, name, role, face) for the header, sidebar rows and the `with:` filter.

## Standing instructions

`loadRunInput` is unchanged; `runAgentTurn` looks up the teammate brief for top-level runs only (not child runs, and not the Spark assistant chat) and passes it as `spark.teammate`. `sparkInstructions` appends it after the clipped Spark block under `# Standing instructions from the user for the Spark teammate …`, saying it is the user's own instruction and not tool output, file content or another agent's message. Claude receives it in the appended system prompt, Codex in developer instructions. When `instructions_path` is set, `briefWithFile` (`apps/server/src/projects/instructions-file.ts`) reads that file for the brief instead of the typed text: an absolute path to a `.md`, `.markdown`, `.mdc` or `.txt` file, checked again after resolving links, never a secret file name, at most 256 KB, valid UTF-8 with no NUL bytes, cut at 2,000 characters. A missing, unreadable or empty file falls back to the typed instructions. `GET /api/instructions-file?path=` returns the same reading for the sheet's preview, and `GET /api/folders?files=instructions[&hidden=1]` lists the files the themed picker (`FolderDialog`, purpose `instructions`) can choose. Only the user sets the path; the Spark tools report it and cannot change it. Editing a teammate's name, role, instructions or instructions file closes its chats' provider sessions so the next turn starts with the new brief. Jev routing and Builder picks are unchanged.

## One job by @mention (migration 0115)

`@Name` in a message of any chat hands that message to the Spark as a subagent; the chat does not become a Spark chat. `findSparkMentions` (contracts) matches the workspace's Spark names case-insensitively after a space, bracket or quote, longest name first, at most three, each once; an unknown name stays plain text, and so does the chat's own Spark.

- `handToSparks` (`apps/server/src/orchestration/spark-handoff.ts`) runs in the chat turn (`workflow/chat-turn.ts`) after the turn is prepared, for top-level runs outside the Spark assistant chat. It inserts an orchestration row (`depth_source = 'user'`) and, for each mentioned Spark in message order, a child run through `insertChildRun` and `executeChildRun`: role `spark`, `route.name`, `route.spark = { id, role, only }`, label `Name · Role`. Stop, the lease heartbeat, approval mirroring, crew messages and restart recovery are the ones every child run has.
- The child has its own session and no chat history. Its prompt (`sparkJobPrompt`) carries the user's message, the open task and its plan summary, linked tickets, a pointer to `git status` and `git diff`, and the main agent's last reply cut to 1,500 characters. `runAgentTurn` gives a `spark` child the Spark's brief (`subagentBrief`, with the instructions file) in the system prompt and writes a `spark/handoff` audit entry on the child run.
- Provider and model are the Spark's when its provider is connected, else the chat's. The run mode is always `ask` (or `chat` without a project): the subagent reads and cannot change files, push or open PRs, whatever the chat's or the Spark's mode and autonomy are. The Spark's own mode and autonomy are not applied.
- `mainAgentContinues` decides what follows. A message that opens with its mentions and has no hand-back word (`then`, `after that`, `once it is done`…) is for the Sparks only: the turn ends with the hand-off note as the assistant message and the main agent does not run. Otherwise the turn continues as usual with the note appended to the prompt and request.
- `handoffNote` holds each Spark's reply cut to a share of 1,200 characters and points at `spark_chat` (`sparkReplies`) for the full text. The Spark's reply is not stored in `messages`, so it never enters the main agent's history; the web reads it from the child run's events.
- Cost and tokens are on the child run and count in the turn's and the chat's totals. Deleting the Spark keeps the name and role on the run.

Web: `suggestSpark` (`apps/web/src/teammates/spark-match.ts`) offers one chip, **Ask Pip (Code reviewer)?**, in the context bar when the draft matches a Spark's name (3 points), its role's concept group such as review, docs, bug, test (2), or a significant role word (1), at 2 points or more; ties go to the earliest matching word. A role with no known concept falls back to the first concept word of the instructions. One-word drafts, slash commands and drafts with a mention get no chip; a dismissed chip stays away until the draft is emptied. The `@` picker lists Sparks above project files. `TurnSection` shows **Handed to** tags on the user message and the Spark's block with its face, name and role; a turn only Sparks worked on shows no main agent block and hides the hand-off note.

Not built yet: a `spark_ask_spark` tool for the main agent to delegate, parallel mentions, and Sparks that change files.

## API

| Method and path                                | Body / result                                                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /api/teammates`                           | `TeammateList`: teammates with state, chat count, last activity, and starters still offered                 |
| `POST /api/teammates`                          | `CreateTeammateRequest` → `Teammate` (400 on bad input or an unconnected provider, 409 on a duplicate name) |
| `PATCH /api/teammates/:id`                     | `UpdateTeammateRequest` → `Teammate`                                                                        |
| `DELETE /api/teammates/:id`                    | 204; chats keep existing, unlinked                                                                          |
| `POST /api/teammates/:id/home`                 | `TeammateChat` (`conversationId`, `teammate`)                                                               |
| `PUT /api/conversations/:id/teammate`          | `{ teammateId: uuid \| null }` → `TeammateChat`                                                             |
| `POST /api/teammate-starters/:starter/dismiss` | 204                                                                                                         |

Contracts live in `packages/contracts/src/teammates.ts`.

## Seam for the desktop island

The island is not wired yet. It can use the same contracts without new server work:

- Roster with blobs and state: `GET /api/teammates` (`teammateListSchema`), refreshed on `teammate`, `conversation`, `run` and `approval` app events. Render faces with the same `faceRender` mapping as `apps/web/src/teammates/face-style.ts`.
- "Talk to" in Quick chat: pick a teammate, then `PUT /api/conversations/:draftId/teammate` before sending the first message with the existing send call; or open its home thread with `POST /api/teammates/:id/home` and send there.

## UI

Home shows **Your Sparks** (cards, **New Spark**, starters when empty). The create/edit sheet reuses `ChoicePicker` with the provider defaults' model and mode choices, and deletes with `HoldToConfirm` plus a 10-second `GracePeriodBar`; nothing is sent until the grace period ends. **Talk to…** is a chip in the composer's context bar, after the project, on Home and in empty chats; its menu uses the project menu's style. The Chats sidebar shows faces on rows and filter chips that write a `with:<name>` search token. Settings has a **Teammates** section (the Sparks list; **Spark** is the app-behaviour section). User guide: `docs/guide/sparks.md`.
