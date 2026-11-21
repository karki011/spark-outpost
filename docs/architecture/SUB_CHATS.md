# Sub-chats

> **Status: design, not built (November 20, 2026).** Sub-chats replace outposts. This document replaces `A2A_CHATS.md` when the old code is deleted (slice 9 of `SUB_CHATS_PLAN.md`). The approved mock is `docs/design/mocks/sub-chats-mock.html`; where the mock and this document differ, this document wins (the mock still draws a needs-you queue above the message box, which is not built).

## 1. What it is

A chat whose agent splits a job becomes a **parent**. Each piece is a **sub-chat**: an ordinary chat with its own worktree, `spark/*` branch and pull request, linked to the parent and shown nested under it. There is no room, no handle, no request card and no second composer.

Six words cover the feature:

| Word     | Meaning                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------- |
| Parent   | A chat that started sub-chats. Any chat with a project can become one; a sub-chat cannot.          |
| Sub-chat | An ordinary chat a parent's agent started. One level only.                                         |
| Plan     | The set of sub-chats of one parent, shown in the **Sub-chats** tab of the parent's Work panel.     |
| Task     | The first message a sub-chat gets. The parent's agent wrote it; it is never the user's message.    |
| Report   | What Spark delivers to the parent when a sub-chat's task turn ends.                                |
| Message  | Text one chat's agent sends another chat with `spark_send_to_chat`, optionally asking for a reply. |

One status vocabulary is used in the sidebar tree, the Sub-chats tab, the report and `spark_chats`: **Needs you, Working, Held, Ready for review, Done** (section 9).

### Owner decisions this design implements

- Outposts are deleted with no deprecation. Former member chats stay as plain chats.
- Only the agent starts sub-chats. There is no menu item, no manual add and no way to pull an existing chat in. The user steers with their own words ("split this", "don't split").
- One level: a sub-chat cannot start sub-chats. No cap on how many sub-chats a parent starts, and no budgets or timers anywhere.
- Each sub-chat opens its own pull request. Spark never merges. There is no "one pull request" mode.
- Text the user did not type is never the user's message.

## 2. What the user sees

### Sidebar

Sub-chats are nested under their parent as a tree with connector lines, in plan order, each with its status. The parent row shows a count of sub-chats that need the user. A parent can be folded. Sub-chats are not listed a second time under their project.

Where the tree is flattened (History, search results, filtered lists, Home, the island, pushes), a sub-chat row reads `<title> ↳ <parent title>`. When the parent is deleted the sub-chat stays as a top-level chat and reads `<title> · was part of <parent title>`.

### Parent chat

- A line under the turn that started them: **Started N sub-chats: a, b, c** with **Sub-chats ›**, which opens the Sub-chats tab.
- The Work panel gets a **Sub-chats** tab, shown only for a chat that has (or had) sub-chats. The existing **Plan** tab (the agent's agreed plan) keeps its name. One row per sub-chat, grouped **Needs you / Ready for review / Working / Held / Done**. A row shows the title, status, branch, pull request and its checks, model, **stacked on X** or **Starts after X, Y**, and **Started by this chat**. A Needs you row shows why (the question or card title) with **Open ›**. A Held row has **Start anyway**. The footer reads "Spark never merges. Each sub-chat publishes under its own mode and autonomy."
- Reports appear in the transcript as a **Report · <sub-chat>** block with fixed fields (section 7).
- There is no needs-you queue above the message box. Approvals and questions are answered in the sub-chat and surface through the existing attention state (island, Dock badge, sidebar count, pushes).

### Plan card (only when the agent's mode asks first)

One card: **Start N sub-chats?** with **Start**, **Edit** and **Discard**. Each row shows the piece number, title, **New branch** / **Stacked on 2** / **Starts after 1, 2, 3**, and its agent, model and effort (**Same as this chat** when inherited). **Edit** turns each row's model and effort into pickers. **Show each task ›** expands the task texts. Nothing else is editable on the card: titles, tasks, order and modes are the agent's proposal, and the user changes a sub-chat's mode in the sub-chat afterwards.

In Auto, Bypass permissions, Auto review and Full access there is no card; the user sees only the "Started N sub-chats" line.

### Sub-chat

- The header has a breadcrumb **‹ <parent>** / **<sub-chat>** and the status.
- The first item is a **Task from <parent>** card: "Started by that chat · not your message", the task text, and "Started with <model> · <effort> effort · <mode> · branch `spark/…`".
- Everything else is an ordinary chat. What the user types is the user's own message to that chat.

### Lines for messages between chats

One line in each chat, under the turn it belongs to:

- Sender: **Asked <chat>: <first line> · Waiting / Replied / No reply** (or **Sent to <chat>: …** when no reply was asked for).
- Receiver: **From <chat>: <first line>** with "not your message".
- Repeated rounds between the same two chats inside one turn collapse into **3 exchanges with <chat>**, which expands.

## 3. Agent tools

Tool availability is decided in three places today and stays there:

- `apps/server/src/spark-mcp/server.ts`: `offeredTo` (`assistantOnly`, `CHAT_TURN_ONLY`, `acts` versus `readOnly`, review runs) and `sparkToolsFor`, which also drops a tool whose `needs` is not available.
- `apps/server/src/spark-mcp/availability.ts`: `sparkAvailability` computes each `SparkToolNeed` per session (today it spreads `outpostNeeds` from `apps/server/src/outposts/outpost-availability.ts`).
- `apps/server/src/agents/acp/spark-tools.ts`: whether a provider gets Spark tools at all; `apps/server/src/crew-flows/held-sends.ts` holds `acts` tools in a test run.

### What the six existing tools do today

| Tool                 | Today                                                                                                                                                                                                                                                     | File                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `spark_start_chat`   | Ask Spark only (`assistantOnly`). Proposes `ask_spark` op `start_chat`: creates a chat in a project and queues the task with origin `assistant`.                                                                                                          | `tools/ask-spark-tools.ts`, `actions/ask-spark-perform.ts` |
| `spark_send_to_chat` | Ask Spark only. Op `send_message`: `addToQueue(origin 'assistant')` then `drainQueue`. It always queues behind a running turn; `sendNow` refuses to steer an `assistant` item ("A message from Ask Spark starts when this chat is free."). No reply path. | same                                                       |
| `spark_stop_chat`    | Ask Spark only. Op `stop_turn`: `stopRun` on the chat's active top-level run.                                                                                                                                                                             | same                                                       |
| `spark_chats`        | Every session. Lists or searches chats: title, projects, last update, state (`working`, `needs_you`, `failed`, `done`, `idle`), provider, model, mode, autonomy.                                                                                          | `tools/chat-tools.ts`                                      |
| `spark_chat`         | Every session. Reads one chat (digest or settings, cost, branch, worktree, messages, cards).                                                                                                                                                              | `tools/chat-tools.ts`                                      |
| `spark_chat_history` | Every session. Reads any chat's full history, compacted turns included.                                                                                                                                                                                   | `tools/history-tool.ts`                                    |

Ask Spark's actions follow **When Ask Spark acts** (`assistantPath` in `actions/ask-spark-limits.ts`); a chat agent's actions follow its mode (`actionPath` in `actions/action-policy.ts`: perform in `auto` and `full_access` postures, in `edits` when the user's message asked, otherwise a card).

### `spark_sub_chats` (new)

One call carries the whole plan:

```
pieces: [{
  title, task,
  project?,            // name or id; default: the parent's project
  agent?, model?, effort?,
  mode?, autonomy?,
  stackedOn?,          // title of another piece in this call
  startsAfter?: [],    // titles of other pieces in this call
}]
```

- Needs `sub_chats`: a chat's own top-level turn, in a chat with a project, that is not a sub-chat, not a turn another chat's message started, not a child run, not a spoken run, not a read-only turn and not a Terminal session. Never Ask Spark (added to `CHAT_TURN_ONLY`).
- Follows the agent's mode like other Spark action tools (new action `start_sub_chats`, with a request pattern in `REQUESTS` so Accept edits performs when the user asked). Otherwise it shows the plan card.
- Checked before anything is created: titles unique in the call, `stackedOn` and `startsAfter` name pieces in the call, no cycle (reuse `storyProblems` and `storyOrder` from `packages/contracts/src/outpost-story.ts`), `stackedOn` only between pieces in the same repository, each project exists and its folder is there, each agent, model, effort and mode is one the provider offers, and the mode cap (section 4).
- On start, per piece: create the chat, copy settings, add the `sub_chats` row, and either deliver the task or leave it Held. One audit entry per sub-chat ("Sub-chat started · By <parent> · model · effort · mode · ran at once (<mode>)" or "approved on a card") and one "Started N sub-chats: a, b, c" line in the parent.
- The result tells the agent the sub-chats are working, that a report arrives for each and a wrap-up at the end, and not to poll.

A parent may call it again later to add pieces. A piece that fails to start (project gone, folder missing) is listed in the result and on the line; the others start.

### `spark_send_to_chat` (extended)

`{ chat, message, reply?: boolean, replyTo?: ask id }`

- Ask Spark keeps today's path unchanged (op `send_message`, **When Ask Spark acts**, never steered).
- For a chat agent it becomes available under the need `chat_messages`: a chat's own top-level turn, not a child run, not a spoken run, not a Terminal session, not a read-only turn. New action `send_to_chat`.
- `reply: true` records an ask in state Waiting. The receiving chat's reply is delivered back as **Reply from <chat>** and starts a turn in the sender (section 6).
- `replyTo` answers an ask addressed to this chat. It needs no card and is allowed in any turn of the receiving chat while that ask is Waiting.
- The tool returns at once with `delivered: 'steered' | 'started' | 'queued'`. It never blocks waiting for the reply, so no provider tool timeout applies.

Who may send to whom:

| From → to                                                                                       | Rule                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parent → its own sub-chat                                                                       | Follows the agent's mode.                                                                                                                                                                                                                                               |
| A turn another chat's message started → that same chat                                          | Follows the agent's mode (reply or ask again).                                                                                                                                                                                                                          |
| A turn a sub-chat's report or reply started in its parent → any of the parent's own sub-chats   | Follows the agent's mode. The parent may coordinate its own sub-chats.                                                                                                                                                                                                  |
| Such a turn → any other chat                                                                    | Refused. No chains.                                                                                                                                                                                                                                                     |
| Any chat → any other chat                                                                       | Performed only when the user's own message in that turn asks for it and names the chat; otherwise a card in every mode. The backend checks the message with `userWroteTurn`, a `send_to_chat` request pattern and `namesChat` (the check Ask Spark's card answers use). |
| Any chat → a Terminal session, Ask Spark's chat, a hidden `crew` chat, an archived chat, itself | Refused.                                                                                                                                                                                                                                                                |

### `spark_stop_chat` (extended)

Ask Spark keeps today's path. A parent gets it for its own sub-chats only (need `sub_chat_stop`: the chat has at least one sub-chat), following the agent's mode (new action `stop_sub_chat`), including in a turn a sub-chat's report or reply started. Audited "Turn stopped · <sub-chat> · By <parent>".

### Tracking

`spark_chats` gains `filter: 'my_sub_chats'` and, per chat, `parent: { id, title } | null` and `subChats: count`. `spark_chat` gains `parent`, and for a parent `subChats: [{ id, title, status, branch, pullRequest, model, effort, stackedOn, startsAfter, waitingOn }]`. `spark_chat_history` is unchanged and already reads another chat. All three stay read tools with no card.

### Prompt guidance

`SPLIT_SUB_CHATS` and `SPLIT_SUB_CHATS_START` in `apps/server/src/workflow/chat-prompt-text.ts` and the Outpost line in `apps/server/src/agents/delegation-policy.ts` are replaced by one rule, added only when `spark_sub_chats` is offered: stay in one chat unless the job has separable parts that ship separately; use provider sub-agents inside the turn for research, review and tests; when the user says to split, split, and when they say not to, don't. A sub-chat's task turn gets the existing assigned-work line with the tool names updated.

## 4. Settings a sub-chat starts with

- A sub-chat copies the parent's agent, model, effort, mode and autonomy as they are at the call. Effort is new: `createMemberChat` in `outposts/start-outpost.ts` copies provider, model, mode and level but not effort; `updateChatSettings` already accepts it.
- The parent's agent may choose another agent, model, effort and autonomy per piece.
- **Mode cap:** a piece's mode must ask at least as often as the parent's (`aboveLeadMode`). A proposed mode above the parent's refuses the whole call with the existing wording. When the piece uses another agent, the inherited mode is mapped to that agent's highest mode that is not above the parent's (`cappedMode`). When the parent's effort is not offered by the piece's model, the first offered effort is used (`firstReportedEffort`).
- The user's card edits change model and effort only.
- After the start the sub-chat is the user's: they may change anything in it, including raising its mode. Later changes to the parent do not propagate.
- The values a sub-chat started with are stored on its row for the task card and the audit.

## 5. Authority

- A task, a message from another chat, a reply, a report and a wrap-up are never the user's message in the receiving chat. They cannot authorise a push, a pull request or a Spark action. The receiving chat's own mode and autonomy decide what happens: a sub-chat at Full auto → PR still opens its pull request, and one at Automatic does not because its parent said so.
- Runs they start have run source `chat`. `userWroteTurn`, `userText`, the publish-step reason, the Spark and workflow extra card, the Spark rules session rule and the chat-started trigger treat `chat` as they treat `assistant` and `workflow` today: not the user's.
- A sub-chat or a turn another chat's message started gets no `spark_sub_chats`. A turn another chat's message started may message only that chat, with one exception: in a turn a sub-chat's report or reply started, the parent may send to (`spark_send_to_chat`) and stop (`spark_stop_chat`) any of its own sub-chats, following its mode. It still may not start new sub-chats or message any other chat in such a turn.
- Text steered into a running turn counts as an untrusted work-data read in the receiving turn (it sets the send flag's note for the rest of that turn). A task or message that starts its own turn is Spark's own record of the chat's work and does not.
- Not offered to spoken runs or child runs. A run started from a paired device gets `spark_sub_chats`, the chat path of `spark_send_to_chat` and `spark_stop_chat` only while that device's remote switches allow the matching routes (`POST /api/conversations`, `POST /api/conversations/:id/queue`, `POST /api/runs/:id/cancel`), using the `deviceRefusal` pattern in `ask-spark-limits.ts`. The plan card is an ordinary Spark action card.
- Every start, task, message, reply, report and stop is an audit entry naming both chats and how it was allowed (mode, card, or "your message asked"), never the text.
- A test run holds all three tools as "would have been sent" (they are `acts` tools).

## 6. Delivery, and what steering can do

### How steering works today (verified)

1. The user's ⌘Enter while a turn runs calls `POST /api/conversations/:id/queue/send-now` (`apps/server/src/api/queue-routes.ts`). `sendNow` in `apps/server/src/workflow/queue-drain.ts` locks the chat; with no active turn it sends the message as an ordinary turn (`outcome: 'sent'`); with one it inserts a `member_messages` row with urgency `now` bound to the running top-level run (`outcome: 'steering'`).
2. The turn's member inbox (`apps/server/src/workflow/member-inbox.ts`, opened in `agent-turn.ts`) polls, claims the row and calls the provider's steer sender.
3. The sender is ACP's custom method `_session/steering` with `idleBehavior: 'promptRequired'` (`apps/server/src/agents/acp/steering.ts`). It is attached only when the agent's `initialize` response carries `_meta.steering.supported`. Both pinned adapters advertise it (Claude and Codex; `docs/architecture/ACP_COMPLIANCE.md`). The outcome `injected` marks the row `delivered`.
4. The steered text is wrapped as `## Message from the user … The user sent this to you directly while you work.` (`messagePrompt`).
5. Fallbacks when the agent does not take it: `'later'` (a background wait is holding) puts the row back to `queued`; otherwise `sendUnsteered` either moves it to the front of `chat_queue` (`queueForLater`, used when it has attachments or sub-agents are still working) or **stops the turn and resends it as the next message** (`interrupt`, then `urgentLeftovers` in `drainQueue`). A row never read is marked `missed` when the turn ends and the user gets **Send again**.
6. `sendNow` refuses to steer anything the user did not type: queue origins `assistant`, `voice` and `pages`, outpost requests and Spark rules retries all wait for the chat to be free.

### How a steered reply is identified today

It is not a separate thing. In a solo turn the agent keeps writing the same assistant message; Spark records where the steer landed (`member_messages.delivered_text_offset`, `delivered_text_before`, `delivered_text_held`, migration `0216`) and the web places the user's steered bubble at that point (`apps/web/src/chat/steer/steer-model.ts`). The only separately stored "steer answer" is for crew turns, where a child run carries `answers: <message id>` (`SteerAnswer.tsx`). Nothing marks where the answer to a steer ends.

### Finding

A steered reply cannot be captured cleanly from the stream: after the offset the agent's text is its answer mixed with the rest of its work, and it ends only when the turn ends. So the reply is not read from the stream. The design is:

1. **Explicit reply.** The steered text ends with "Answer with spark_send_to_chat, replyTo <ask id>." A `replyTo` call is the reply, delivered at once. This is the only path that gives a prompt reply from a busy chat.
2. **Turn reply.** When the message started its own turn (the receiver was idle, or the message waited in the queue), the reply is that turn's final reply, taken when the run succeeds. This is today's outpost "answer" rule.
3. **Tail fallback.** A steered ask whose turn ends without a `replyTo` call is settled from the text the turn wrote after the delivery offset, clipped, and labelled "taken from its turn". If that text is empty the ask ends **No reply**.

If the owner prefers no tail fallback, the alternative is the one named in the brief: do not steer asks that want a reply; queue them and use rule 2 only. That costs promptness, not correctness, and is a one-line change in the delivery pass.

### Delivery rules for a message from another chat

- Receiver idle: add to `chat_queue` with origin `chat` and drain; the message starts a turn (run source `chat`).
- Receiver mid-turn: insert a `member_messages` row (urgency `now`) whose id is the ask id. The inbox steers it with a different wrapper: `## Message from the chat "<title>" (not from the user)`, the text marked as data, and the reply instruction when a reply is wanted.
- If the agent cannot take it now: the row goes to the front of the chat queue (`queueForLater`). A message from another chat **never** takes the `interrupt` path; another chat cannot stop a turn by messaging it. This is the one behavioural change inside `member-inbox.ts`: rows that belong to an ask skip `interrupt` and skip `missed` (they are queued instead).
- Spark pause, an archived receiver and a stopped last turn hold a queued message exactly as they hold other queue items; the ask stays Waiting and the sender's line says why.
- The user can remove a queued message from another chat in the receiving chat's queue strip (not edit it); the ask then ends No reply.

### Ask states

Three stored states, for messages sent with `reply: true` and for tasks:

| State    | When                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Waiting  | From creation until a reply or an end.                                                                                                                     |
| Replied  | A reply was recorded (rules 1 to 3).                                                                                                                       |
| No reply | The receiving turn failed or was stopped, the queued message was removed, the receiver was deleted, or a steered turn ended with nothing after the offset. |

A reply (and a No reply notice) is itself delivered to the sender by the same delivery rules: steered when the sender is mid-turn, otherwise it starts a turn. There is no waiting tool call and no deadline.

## 7. Reports and the wrap-up

- The task is an ask from the parent to the sub-chat. Its reply is the **report**. Later messages from the parent with `reply: true` are reported the same way.
- Spark builds the report when the turn the task started ends. Fixed shape:
  - **Changed**: from the sub-chat's reply.
  - **Branch and pull request**: Spark's own record (branch, committed, pushed, pull request number, state and checks), never the agent's claim.
  - **Risks** and **Blockers**: from the sub-chat's reply.
  - Footer: "Written by the sub-chat's agent, not checked by Spark".
- The task wrapper asks the sub-chat's agent to end its reply with `Changed:`, `Risks:` and `Blockers:` sections. Spark reads those sections; a missing one reads "None stated", and with none of them the reply's opening lines become Changed. A failed or stopped task turn sends a report with status Needs you and the reason.
- A turn the user typed in a sub-chat, and a pull request follow-up round, update the sub-chat's row (latest report, status) and the Sub-chats tab. They do not start a turn in the parent.
- A sub-chat "has reported" when its row's latest report has no failure reason. A deleted or archived sub-chat counts as reported, so nothing waits on it forever.
- **Wrap-up:** when no sub-chat of the parent is Working and none can still start by itself (each has reported, failed or been stopped, or is Held behind one that failed or was stopped), Spark sends the parent one wrap-up: every sub-chat's status with Spark's own branch, commit, push and pull request record, and the order to merge stacked pull requests. It runs as a read-only reply (`asWrapUpReply`: a Do turn becomes an Ask turn), starts no build and no publish step, and authorises no push or pull request at any level or in any mode. It is written once per settled set; adding pieces later allows one more.

## 8. Landing: stacked sub-chats

Today's stacked-branch rules are kept and re-keyed from story tasks to `sub_chats.stacked_on`:

- A stacked sub-chat's worktree branches from the sub-chat it is stacked on (`stackParentOf` in `orchestration/chat-place.ts`), and its pull request targets that branch while that pull request is open, otherwise the default branch (`prBase`).
- It pushes only its own branch, never force pushes, updates by merge, and is refused a push by `spark_push` and by a gated `git push` while its parent branch is not on the remote (`approvals/publish-policy.ts`, `approvals/stacked-push.ts`, `ship/agent-push.ts`); in a mode the gate cannot see the push is flagged, never stopped (`observations/stacked-push-watch.ts`).
- A stacked sub-chat is always Held until the one it is stacked on has reported. At Automatic, Spark first commits that sub-chat's kept changes on its own `spark/*` branch (a local commit like Ship → Commit, never pushed); if the commit cannot be made the stacked sub-chat stays Held (`stacked-parent-work.ts`).
- `startsAfter` alone is order only. A Held sub-chat starts when everything it waits on has reported. When something it waits on failed or was stopped it stays Held and says so; **Start anyway** on the sub-chat row starts it.
- Stack warnings (`stackWarnings`: parent not pushed, behind parent, base merged, base mismatch) show on the sub-chat row.

## 9. Status

One pure function in `packages/contracts/src/sub-chat-status.ts` maps a sub-chat to one word, first match wins:

| Status           | When                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Held             | Not started yet.                                                                                |
| Needs you        | A card or question is waiting in it, or its last turn failed or was stopped.                    |
| Working          | A turn is running, queued or sleeping, or its task is queued.                                   |
| Ready for review | Its last turn succeeded and it has an open pull request or kept changes not yet merged.         |
| Done             | Its pull request is merged or closed, or it finished with nothing to review, or it is archived. |

Chats that are neither a parent's sub-chat nor shown in a Sub-chats tab keep today's sidebar row states. Sub-chat approvals, questions, finished and failed turns are ordinary attention items; no new attention kind is added.

## 10. Data model

Migration `0268_sub_chats.sql` (the highest migration on this branch is `0267_workflow_run_base_head.sql`; take the next free number if `main` moved).

```sql
CREATE TABLE sub_chats (
  conversation_id uuid PRIMARY KEY REFERENCES conversations (id) ON DELETE CASCADE,
  parent_conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  parent_title text NOT NULL,
  position integer NOT NULL,
  task text NOT NULL,
  stacked_on uuid REFERENCES conversations (id) ON DELETE SET NULL,
  starts_after uuid[] NOT NULL DEFAULT '{}',
  started_at timestamptz,
  started_with jsonb NOT NULL,
  approval_id uuid REFERENCES approvals (id) ON DELETE SET NULL,
  task_ask_id uuid,
  report jsonb,
  reported_at timestamptz,
  wrapped_up_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sub_chats_not_own_parent CHECK (parent_conversation_id <> conversation_id),
  CONSTRAINT sub_chats_not_own_stack CHECK (stacked_on <> conversation_id)
);
CREATE INDEX sub_chats_parent ON sub_chats (parent_conversation_id, position);

CREATE TABLE chat_asks (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('task', 'message', 'reply', 'report', 'wrap_up')),
  from_conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  from_run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  from_title text NOT NULL,
  to_conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  body text NOT NULL,
  reply_to uuid REFERENCES chat_asks (id) ON DELETE SET NULL,
  state text CHECK (state IN ('waiting', 'replied', 'no_reply')),
  delivered_as text CHECK (delivered_as IN ('turn', 'steer')),
  run_id uuid REFERENCES runs (id) ON DELETE SET NULL,
  no_reply_reason text,
  report jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX chat_asks_to ON chat_asks (to_conversation_id, created_at);
CREATE INDEX chat_asks_from ON chat_asks (from_conversation_id, created_at);
CREATE INDEX chat_asks_undelivered ON chat_asks (created_at) WHERE delivered_as IS NULL;
CREATE INDEX chat_asks_waiting ON chat_asks (run_id) WHERE state = 'waiting';
```

Plus, in the same migration: `chat_queue_origin_check` gains `'chat'`, and `runs_source_check` gains `'chat'`. `chat_asks.report` (the structured report on a `report` ask) is added by `0269_chat_ask_report.sql`.

Notes:

- `sub_chats` holds the link, the plan (stack, order, held) and the latest report, so no column is added to `conversations` and no chat write path changes. `started_at IS NULL` is Held. The one-level rule is enforced in code under a lock on the parent row: a chat with a `sub_chats` row cannot be a `parent_conversation_id`.
- `parent_title` is written at the start and refreshed by the user's delete path (`persistence/conversation-actions.ts`) just before the parent row goes, so "was part of <name>" survives the `SET NULL`.
- `starts_after` is an array without foreign keys; an id that no longer exists counts as reported.
- An ask's id is reused as the `chat_queue.id`, the `member_messages.id` and the `messages.id` of the turn it starts, the way an outpost post id is today. That is how the queue, the inbox and the run find their ask without extra columns, and it makes delivery idempotent (`ON CONFLICT (id) DO NOTHING`).
- `state` is null for a message that wants no reply. `from_conversation_id` is null for a wrap-up (Spark wrote it) and after the sender is deleted; `from_title` keeps the name for the line.
- There is no plan table: a waiting plan lives in its approval card's payload, and a started plan is its `sub_chats` rows.

Migration `0270_drop_outposts.sql` (slice 8):

- `UPDATE runs SET source = 'chat'` for outpost runs whose post was not typed by the user, and `'queue'` for those whose post was (`outpost_posts.from_user`), then recreate `runs_source_check` without `'outpost'`.
- Delete `chat_queue` rows with `outpost_post_id`, then drop `chat_queue.outpost_post_id` and its index.
- Drop `outpost_story_tasks`, `outpost_drafts`, `outpost_posts`, `outpost_members`, `outposts`.
- Close pending `start_outpost` approval cards as expired.
- Former member chats keep their messages, worktrees, branches and pull requests. Their old request turns render as "From another chat · not your message".

## 11. Server shape

New folder `apps/server/src/sub-chats/`:

| Module                                                                                             | Does                                                                                                                                         | Comes from                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan.ts`                                                                                          | Validate a `spark_sub_chats` call (pure)                                                                                                     | `outposts/story-start.ts`, `tools/outpost-proposal.ts` (the checks only)                                                                                                           |
| `start.ts`                                                                                         | Create the chats, copy settings, write rows, deliver or hold tasks                                                                           | `outposts/start-outpost.ts` (`createMemberChat`, title, mode hold)                                                                                                                 |
| `mode-cap.ts`, `proposed-mode.ts`, `chat-posture.ts`                                               | Mode cap and mode lookup                                                                                                                     | moved from `outposts/` with handle wording replaced by titles                                                                                                                      |
| `stack-base.ts`, `stack-git.ts`, `stack-publish.ts`, `stacked-parent-work.ts`, `git-read-cache.ts` | Stack base, remote check, pull request base, local parent commit                                                                             | moved from `outposts/`, queries re-keyed to `sub_chats`                                                                                                                            |
| `asks.ts`                                                                                          | Create and settle asks, the send rules of section 3                                                                                          | new (replaces `post-service.ts`, `post-rules.ts`)                                                                                                                                  |
| `delivery.ts`                                                                                      | One pass, woken by app events: settle asks, write reports, release Held sub-chats, queue wrap-ups, deliver undelivered asks (steer or queue) | replaces `a2a/dispatcher.ts`, `a2a/hold-release.ts`, `outposts/mount.ts`                                                                                                           |
| `report.ts`                                                                                        | Build the fixed-shape report (pure)                                                                                                          | new; branch facts from `outposts/story-view.ts`                                                                                                                                    |
| `wrap-up.ts`, `wrap-up-turn.ts`                                                                    | Wrap-up text and its read-only turn                                                                                                          | moved from `outposts/story-wrap-up.ts`, `wrap-up-turn.ts`, `story-wrap-ups.ts`                                                                                                     |
| `message-prompt.ts`                                                                                | Wrappers for a task, a message, a reply, a report                                                                                            | replaces `outposts/request-prompt.ts`                                                                                                                                              |
| `availability.ts`                                                                                  | `sub_chats`, `chat_messages`, `sub_chat_stop` needs                                                                                          | replaces `outposts/outpost-availability.ts`                                                                                                                                        |
| `user-asked.ts`                                                                                    | `userText`, `isWrapUp`                                                                                                                       | moved from `outposts/user-asked.ts` (imported by `crew-flows/workflow-turn.ts`, `workflow/chat-turn-steps.ts`, `publish-context.ts`, `publish-step-reason.ts`, `action-policy.ts`) |

Contracts: `sub-chats.ts` (schemas for the plan action, sub-chat rows (`SubChatRow`), asks), `sub-chat-status.ts`, `sub-chat-stack.ts` (from `outpost-stack.ts` and the stack parts of `outpost-story.ts`), `sub-chat-mode-cap.ts` (from `outpost-mode-cap.ts`). App event `sub_chats_changed` replaces `outpost_changed`.

Delivery runs in the API process where the dispatcher runs today (`api/main.ts`); the worker needs only `stackGit` in its Spark tool deps. A2A is not used: nothing here needs an agent protocol between two chats in one process, so `@a2a-js/sdk` is removed. Should chats on different machines ever talk, that is the time to add a protocol.

### Routes

| Route                                                    | Use                                 | Paired device                                                                   |
| -------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/conversations/:id/sub-chats`                   | Sub-chat rows for the Sub-chats tab | Allowed with reading chats                                                      |
| `POST /api/conversations/:id/sub-chats/:subChatId/start` | Start anyway                        | Allowed with sending messages (the rule of `POST /api/conversations/:id/queue`) |

Everything else rides existing routes: the conversation list and detail carry `parent`, `formerParent`, `subChat` and `asks`; the plan card is answered through the approvals route; the queue routes remove a queued message. Each new route gets its line in `apps/server/src/remote/route-rules.ts` or the policy test fails.

## 12. Where outposts are referenced outside the three folders

Found with `git grep -iP '(?<!spark )(?<!spark-)(?<!spark)(?<!spark_)(?<!@spark-)outpost|spark_outpost_?(ask|note|draft|start)\b|spark_post_outpost|\ba2a\b'`. Product-name hits are excluded; files marked (name) only import a helper that lives in an outpost folder and must be moved first.

**Server, tools and actions:** `spark-mcp/server.ts`, `availability.ts`, `tool.ts`, `deps.ts`, `guide/sections.ts`, `tools/outpost-*.ts` (9 files), `tools/ask-spark-island-tools.ts` (`spark_post_outpost`), `tools/ask-spark-tools.ts`, `actions/outpost-actions.ts`, `actions/perform.ts`, `actions/confirm.ts`, `actions/action-policy.ts` (`start_outpost`, `outpost_run`, `from_user`), `actions/ask-spark-inbox.ts`, `actions/ask-spark-limits.ts`, `actions/ask-spark-perform.ts`, `actions/rules-edit-session.ts`, `agents/acp/spark-tools.ts` (`FALLBACK_NAME = 'spark_outpost'` is the MCP server name, keep), `agents/delegation-policy.ts`.

**Server, turn and queue:** `workflow/run-input.ts` (46 hits: `outpostRequest`), `agent-turn.ts` (preamble), `chat-turn.ts`, `chat-turn-prompt.ts`, `chat-turn-steps.ts`, `chat-prompt.ts`, `chat-prompt-text.ts`, `command-scope.ts`, `publish-context.ts`, `publish-step-reason.ts`, `queue-drain.ts`, `main.ts` (wakes, `stackGit`), `orchestration/chat-place.ts`, `compaction/summary.ts`, `crew-flows/chat-started.ts`, `crew-flows/workflow-turn.ts`.

**Server, persistence and API:** `persistence/outpost*.ts` (10 files), `rows.ts` (`RUN_OUTPOST_COLUMNS`), `runs.ts`, `conversations.ts`, `summary-query.ts`, `conversation-search.ts`, `chat-queue.ts`, `queue-handoff.ts`, `queued-attachments.ts`, `attachments.ts`, `auto-title.ts`, `inactive-chats.ts`; `api/outpost-routes.ts`, `api/app.ts`, `api/main.ts`, `api/routes.ts`, `api/queue-routes.ts`; `remote/route-rules.ts`, `remote/policy.test.ts`; `apps/server/package.json` (`@a2a-js/sdk`).

**Server tests:** `apps/server/test/a2a-*.ts` (9), `accepting-peer.ts`, `fake-peer-agent.ts`, `outpost*.db.test.ts`, `post-*.test.ts`, `request-prompt.test.ts`, `story-*.test.ts`, `start-outpost.db.test.ts`, `stack-*.test.ts`, `stacked-parent-work.db.test.ts`, `dependency-release.test.ts`, `handshake.test.ts`, `mode-cap.test.ts`, `proposed-mode.test.ts`, `user-asked.test.ts`, `agent-prompt*.test.ts`, `chat-turn-outposts.db.test.ts`, and outpost cases inside `archive-inactive`, `ask-spark-island`, `attachment-reservations`, `chat-turn-whole`, `compaction-summary`, `crew-trigger-chat-started`, `merged-change-events`, `migrate-startup`, `remote-policy`, `spark-mcp-availability`, `spark-mcp-setup`, `spark-pause`, `spark-tool-budget`, `spark-tool-sizes.ts`, `work-reply-readers`, `live-reuse*`, `app-support.ts`, `remote-routes-support.ts`.

**Contracts:** `outpost*.ts` (12 modules and tests), `index.ts`, `runs.ts` (`Run.outpost`, `OUTPOST_DRAFT_ACTIVITY`), `conversations.ts` (`ConversationSummary.outpost`), `crew-messages.ts` (`outpostPostId`), `app-events.ts`, `ask-spark-action.ts` (`post_outpost`, `outpostId`), `attention-report.ts`, `remote.ts` (switch wording), `spark-actions.ts`, `tool-steps.ts`.

**Web:** `app/App.tsx`, `app/lazy-views.tsx`, `app/use-outpost-route.ts`, `app/live/app-event-keys.ts`; `chat/outpost/*` (16 files), `chat/TurnSection.tsx`, `chat/approvals/OutpostStartFacts.tsx`, `SparkActionCard.tsx`, `chat/project/ContextBar.tsx`, `chat/queue/queue-model.ts`, `chat/retry-turn.ts`, `chat/run-refresh.ts`; `conversations/ActiveChats.tsx`, `AddToOutpost.tsx`, `ChatMenu.tsx`, `ChatRowMenu.tsx`, `ConversationList.tsx`, `OutpostGroup.tsx`, `OutpostRows.tsx`, `outpost-members.ts`, `outpost-rows.css`, `on-screen.ts`, `sidebar-layout.css`; `crew/AgentTvHost.tsx`; `island/island-rest-line.ts`, `island/use-island-moments.ts`; `phone/PhoneSetup.tsx`; `ui/icons.tsx` (`OutpostIcon`); `apps/desktop/src/attention-feed.ts`.

**Web (name):** `github/GithubDetail.tsx`, `github/GithubRow.tsx`, `github/review/review-model.ts` import `webLink` from `outposts/post-text.ts`; tests in `island/`, `phone/`, `calendar/`, `desktop/` import `outposts/test-fixtures.ts`.

**Browser tests:** 14 `tests/browser/outpost*.spec.ts` and `outposts*.spec.ts`, `markdown-composer-outpost.spec.ts`, `outposts-kit.ts` (also exports `asPairedPhone`, used by `model-default.spec.ts`), `spec-map.ts`, `database.ts` (table list), and outpost cases in `add-folder.spec.ts`, `agent-tv-list.spec.ts`, `agent-tv-bounds.spec.ts`, `phone-context-bar.spec.ts`; `scripts/test-selection.ts`.

**Docs and copy:** `AGENTS.md`; guide pages `outposts.md`, `outpost-asks.md`, `outpost-stories.md`, `outpost-permissions.md`, `when-to-use-an-outpost.md`, `stacked-pull-requests.md`, and mentions in `spark-tools.md`, `glossary.md`, `statuses-and-limits.md`, `guardrails.md`, `how-spark-works.md`, `pause-spark.md`, `ship-and-pull-requests.md`, `start-a-chat.md`, `use-your-phone.md`, `README.md`; `docs/architecture/A2A_CHATS.md` and mentions in `PROTOCOL_ALIGNMENT.md`, `PHONE_REMOTE.md`, `REMOTE_CONTROL.md`, `SIMPLE_ORCHESTRATION*.md`, `CREW_WORKFLOWS_PLAN.md`, `HARNESS_*.md`, `LESSONS.md`, `COMPACTION.md`, `ELECTRON_PLAN.md`, `MAC_CONTROL.md`, `NATIVE_TERMINALS.md`, `REPO_AGENT_CONFIG.md`, `SPARK_SLEEP.md`, `SPARK_TOOLS.md`; `docs/product/PLAN.md`; `docs/design/mockup/outpost.html`, `outpost-create.html`; the repository `README.md` guide table; `apps/site/index.html` ("start sub-chats in an outpost").

**Not the feature, leave:** `apps/web/src/onboarding/DoneStep.tsx` ("Here's your outpost"), `chat/project/TrustCards.tsx` ("Outpost's safety rules"), `brand/ProviderBlob.tsx`, `scripts/turn-tasks/rows/review-marks.ts`, `apps/server/src/spark-rules/managed-writer.test.ts`, `apps/desktop/src/browser/downloads-list.test.ts`, `releases/0.1.0-beta.1.md`, `apps/desktop/CHANGELOG.md`, `docs/benchmarks/`, old migrations.

## 13. Not built

- A user entry point for starting, adding or adopting sub-chats.
- Nesting deeper than one level, and a sub-chat with two parents.
- One combined pull request, and any merge by Spark.
- A needs-you queue above the parent's message box.
- Messages to or from Terminal sessions; `@all`; notes that start nothing; pinned notes; shared instructions; a library tab.
- A blocking "ask and wait" tool call. Replies arrive as a later turn or a steer.
- A cost roll-up across sub-chats, and a combined Agent TV stage.
- Any agent protocol between chats (A2A is removed).
