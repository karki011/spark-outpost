# Sparks: named teammates

A Spark (code name: teammate) is a named, long-lived preset for chats. It owns no execution: the harness runs every teammate chat exactly like any other chat. A teammate only supplies defaults when a chat starts and standing instructions on every main-session turn.

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

`loadRunInput` is unchanged; `runAgentTurn` looks up the teammate brief for top-level runs only (not Builders, Critics or other child runs, and not the Spark assistant chat) and passes it as `spark.teammate`. `sparkInstructions` appends it after the clipped Spark block under `# Standing instructions from the user for the Spark teammate …`, saying it is the user's own instruction and not tool output, file content or another agent's message. Claude receives it in the appended system prompt, Codex in developer instructions. When `instructions_path` is set, `briefWithFile` (`apps/server/src/projects/instructions-file.ts`) reads that file for the brief instead of the typed text: an absolute path to a `.md`, `.markdown`, `.mdc` or `.txt` file, checked again after resolving links, never a secret file name, at most 256 KB, valid UTF-8 with no NUL bytes, cut at 2,000 characters. A missing, unreadable or empty file falls back to the typed instructions. `GET /api/instructions-file?path=` returns the same reading for the sheet's preview, and `GET /api/folders?files=instructions[&hidden=1]` lists the files the themed picker (`FolderDialog`, purpose `instructions`) can choose. Only the user sets the path; the Spark tools report it and cannot change it. Editing a teammate's name, role, instructions or instructions file closes its chats' provider sessions so the next turn starts with the new brief. Jev routing and Builder picks are unchanged.

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

Home shows **Your Sparks** (cards, **New Spark**, starters when empty). The create/edit sheet reuses `ChoicePicker` with the provider defaults' model and mode choices, and deletes with `HoldToConfirm` plus a 10-second `GracePeriodBar`; nothing is sent until the grace period ends. **Talk to…** sits above the composer on Home and in empty chats. The Chats sidebar shows faces on rows and filter chips that write a `with:<name>` search token. Settings has a **Sparks** section. User guide: `docs/guide/sparks.md`.
