# Sub-chats

> **Status: built (November 20, 2026).** Sub-chats replaced outposts, and this document replaced `A2A_CHATS.md`. It describes the code as it is; section 13 lists the decisions taken while building and section 14 what is not built. The approved mock is `docs/design/mocks/sub-chats-mock.html`; where the mock and this document differ, this document wins (the mock still draws a needs-you queue above the message box, which is not built).

## 1. What it is

A chat whose agent splits a job becomes a **parent**. Each piece is a **sub-chat**: an ordinary chat with its own worktree, `spark/*` branch and pull request, linked to the parent and shown nested under it. There is no room, no handle, no request card and no second composer.

Six words cover the feature:

| Word     | Meaning                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------- |
| Parent   | A chat that started sub-chats. Any chat with a project can become one; a sub-chat cannot.          |
| Sub-chat | An ordinary chat a parent's agent started. One level only.                                         |
| Plan     | The set of sub-chats of one parent, shown in the **Sub-chats** tab of the parent's Work panel.     |
| Task     | The first message a sub-chat gets. The parent's agent wrote it; it is never the user's message.    |
| Report   | What Spark sends the parent when a sub-chat's task turn ends.                                      |
| Message  | Text one chat's agent sends another chat with `spark_send_to_chat`, optionally asking for a reply. |

One status vocabulary is used in the sidebar tree, the Sub-chats tab, the report and `spark_chats`: **Needs you, Working, Held, Ready for review, Done** (section 9).

### Owner decisions

- Outposts are deleted with no deprecation. Former member chats stay as plain chats.
- Only the agent starts sub-chats. There is no menu item, no manual add and no way to pull an existing chat in. The user steers with their own words ("split this", "don't split").
- One level: a sub-chat cannot start sub-chats. No cap on how many sub-chats a parent starts, and no budgets or timers anywhere.
- Each sub-chat opens its own pull request. Spark never merges. There is no "one pull request" mode.
- Text the user did not type is never the user's message.

## 2. What the user sees

### Sidebar

Sub-chats are nested under their parent as a tree with connector lines, in plan order, each with its status. The parent row shows a count of sub-chats that need the user. A parent can be folded (← and → fold, unfold and move between a parent and its sub-chats; the fold is remembered), and a folded parent unfolds when one of its sub-chats becomes the selected chat. Sub-chats are not listed a second time under their project. A sub-chat is not draggable out of its parent. A row wraps its status under the title when both do not fit, instead of cutting the title.

Where the tree is flattened (History, search results, filtered lists, Home, the island, pushes), a sub-chat row reads `<title> ↳ <parent title>`. When the parent is deleted the sub-chat stays as a top-level chat and reads `<title> · was part of <parent title>`. The rows read that way from the moment the user confirms the delete, through the Undo window (`leavingDeletedParents` in `sub-chat-tree.ts`); Undo puts them back under the parent. When the delete finishes, the same function rewrites the cached chat list, the older-chats pages and every cached search (`dropDeletedChat` in `deleted-chat-cache.ts`): the parent goes and its sub-chats carry `formerParent` instead of `parent`, so no row points at the deleted parent while the lists refetch, and the older-chats pages, which no event refetches, stay right.

### Parent chat

- A line under the turn that started them: **Started N sub-chats: a, b, c** with **Sub-chats ›**, which opens the Sub-chats tab.
- The Work panel has a **Sub-chats** tab, shown only for a chat that has (or had) sub-chats. The existing **Plan** tab (the agent's agreed plan) keeps its name. A parent with no task of its own has no tab strip, so the same rows show under a **Sub-chats** heading. One row per sub-chat, grouped **Needs you / Ready for review / Working / Held / Done**; an empty group is not shown. A row shows the title, status, branch, pull request and its checks, model, **stacked on X** or **Starts after X, Y**, and **Started by this chat**. A Needs you row shows why (the question or card title) with **Open ›**. A Held row says what it waits for and has **Start anyway**. The footer reads "Spark never merges. Each sub-chat publishes under its own mode and autonomy."
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
- Receiver: **From <chat>: <first line>** with "not your message". A turn another chat's message started has that message as its header (the task card, the report block, or a "From <chat> · not your message" fold) instead of a user bubble, and offers no Retry as the user.
- Two or more exchanges with the same chat inside one turn collapse into **N exchanges with <chat>**, which expands. Tasks, reports and replies a chat sent get no line of their own in that chat.
- A queued message from another chat shows in the receiving chat's queue strip tagged "From <chat>"; the user can remove it, not edit it, and not send it now.

## 3. Agent tools

Tool availability is decided in three places:

- `apps/server/src/spark-mcp/server.ts`: `offeredTo` (`assistantOnly`, `CHAT_TURN_ONLY`, `acts` versus `readOnly`, review runs) and `sparkToolsFor`, which also drops a tool whose `needs` is not available.
- `apps/server/src/spark-mcp/availability.ts`: `sparkAvailability` computes each `SparkToolNeed` per session and takes `sub_chats`, `sub_chat_stop` and `chat_messages` from `apps/server/src/sub-chats/availability.ts`.
- `apps/server/src/agents/acp/spark-tools.ts`: whether a provider gets Spark tools at all; `apps/server/src/crew-flows/held-sends.ts` holds `acts` tools in a test run.

A chat agent's actions follow its mode (`actionPath` in `actions/action-policy.ts`: perform in `auto` and `full_access` postures, in `edits` when the user's message asked, otherwise a card). Ask Spark's follow **When Ask Spark acts** (`assistantPath` in `actions/ask-spark-limits.ts`). `spark_start_chat` stays Ask Spark's only; `spark_chats`, `spark_chat` and `spark_chat_history` are read tools every session gets.

### `spark_sub_chats`

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

- Needs `sub_chats`: a chat's own top-level turn, in a chat with a project, that is not a sub-chat, not a turn another chat's message started, not a child run, not a spoken run, not a read-only turn and not a Terminal session. Never Ask Spark (it is in `CHAT_TURN_ONLY`). A chat with no project does not carry the tool.
- Follows the agent's mode like other Spark action tools (action `start_sub_chats`, with a request pattern in `REQUESTS` so Accept edits performs when the user asked). Otherwise it shows the plan card. The card's payload is the whole resolved plan: each piece carries its new chat's id, and `stackedOn` and `startsAfter` hold those ids, so performing it twice starts nothing twice. The card's edits are `edits.subChats: [{ id, model?, effort? }]`.
- Checked before anything is created: titles unique in the call, `stackedOn` and `startsAfter` name pieces in the call, no cycle (`stackOrder` in `packages/contracts/src/sub-chat-stack.ts`), `stackedOn` only between pieces in the same repository, each project exists and its folder is there, each agent, model, effort and mode is one the provider offers, and the mode cap (section 4).
- On start, per piece: create the chat, copy settings, add the `sub_chats` row, and either deliver the task or leave it Held. One audit entry per sub-chat (`spark/sub_chat`, event `sub_chat_started`, naming the parent, model, effort, mode and whether it ran at once or was approved on a card, never the task text) and one "Started N sub-chats: a, b, c" line in the parent. The line is a run activity `sub_chats_started` on the parent's turn (`{ subChats: [{ id, title, held }], notStarted: [{ title, reason }] }`), written by the perform step so it also appears when the card is answered after the turn ended; the web reads it from `ConversationDetail.subChatStarts`.
- The result tells the agent the sub-chats are working, that a report arrives for each and a wrap-up at the end, and not to poll.

A parent may call it again later to add pieces. A piece that fails to start (project gone, folder missing) is listed in the result and on the line; the others start. A piece stacked on one that did not start does not start either, and a `startsAfter` on a piece that did not start is dropped.

### `spark_send_to_chat`

`{ chat, message, reply?: boolean, replyTo?: ask id }`

- Ask Spark has its own path (op `send_message`, **When Ask Spark acts**, never steered); the tool picks the path by `scope.assistant`.
- A chat agent gets it under the need `chat_messages`: a chat's own top-level turn, not a child run, not a spoken run, not a Terminal session, not a read-only turn. Action `send_to_chat`.
- `reply: true` records an ask in state Waiting. The receiving chat's reply is delivered back as **Reply from <chat>** and starts a turn in the sender (section 6).
- `replyTo` answers an ask addressed to this chat. It needs no card and is allowed in any turn of the receiving chat while that ask is Waiting. `replyTo` on a task is refused: a task always ends in a report.
- The tool returns at once with `delivered: 'steered' | 'started' | 'queued'`. It never blocks waiting for the reply, so no provider tool timeout applies.

Who may send to whom:

| From → to                                                                                       | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Parent → its own sub-chat                                                                       | Follows the agent's mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A turn another chat's message started → that same chat                                          | Follows the agent's mode (reply or ask again).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A turn a sub-chat's report or reply started in its parent → any of the parent's own sub-chats   | Follows the agent's mode. The parent may coordinate its own sub-chats.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Such a turn → any other chat                                                                    | Refused. No chains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Any chat → any other chat                                                                       | Performed only when the user's own message in that turn asks for it and names the chat; otherwise a card in every mode. The backend checks the message with `userWroteTurn` and `askedToSend` in `actions/action-policy.ts`, which runs `commandNames` (the check Ask Spark's card answers use, unchanged for them) over the message with the chat's title replaced by a plain token, so a title holding a period or a hold-back word still matches; "wait for its reply" does not count as holding back, and a mention that is part of a longer chat title does not name this chat. The answered card then reads "Done without a card: your message asked for it." (`sparkAskedFor` on the card's payload). |
| Any chat → a Terminal session, Ask Spark's chat, a hidden `crew` chat, an archived chat, itself | Refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### `spark_stop_chat`

Ask Spark has its own path (any chat). A parent gets it for its own sub-chats only (need `sub_chat_stop`: the chat has at least one sub-chat), following the agent's mode (action `stop_sub_chat`), in a turn the user started or one its own sub-chat's report or reply started, not in a turn any other chat's message started. Audited as `spark/sub_chat`, event `turn_stopped`, naming the sub-chat and the parent.

### Tracking

`spark_chats` has `filter: 'my_sub_chats'` and, per chat, `parent: { id, title } | null` and `subChats: count`. `spark_chat` has `parent`, and for a parent `subChats: [{ id, title, status, branch, pullRequest, model, effort, stackedOn, startsAfter, waitingOn }]`. `spark_chat_history` reads another chat. All three are read tools with no card.

### Prompt guidance

One rule (`SPLIT_SUB_CHATS_TOOL` in `apps/server/src/workflow/chat-prompt-text.ts`) is in the session prompt of a chat that can split (a chat with a project that is not a sub-chat): stay in one chat unless the job has separable parts that ship separately; use provider sub-agents inside the turn for research, review and tests; when the user says to split, split, and when they say not to, don't. It is a fact of the chat, not of the turn, so the session prompt stays the same across turns. A sub-chat's task turn gets the assigned-work turn note (`chatTurnNote`: execute the assigned slice, return evidence to the chat that assigned it, start no chats); later turns in a sub-chat do not.

### Tool sizes

`pnpm exec tsx scripts/spark-tool-budget.ts`, November 20, 2026 (characters of the tool list a session is sent):

| Case                               | Size                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Plain chat, nothing connected      | 35 tools, 27,796 (cap 27,800 in `spark-tool-budget.test.ts`; 26,997 before `spark_send_to_chat`); instructions 1,628 (cap 1,650) |
| Linked project, GitHub connected   | 47 tools, 37,811 (40,259 with the outpost tools)                                                                                 |
| Everything connected, Browser pane | 79 tools, 73,937 (80,858 with the outpost tools)                                                                                 |
| Ask Spark, plain chat              | 37 tools, 28,327                                                                                                                 |
| `spark_sub_chats`                  | 1,467 (cap 1,500), only in a chat with a project                                                                                 |
| `spark_send_to_chat`               | 778, every chat                                                                                                                  |
| `spark_stop_chat`                  | 600, a parent and Ask Spark                                                                                                      |

The plain-chat list held no outpost tool, so removing outposts did not change it; the room for `spark_sub_chats` under the cap came from trimming the `spark_chats` and `spark_chat` descriptions.

## 4. Settings a sub-chat starts with

- A sub-chat copies the parent's agent, model, effort, mode and autonomy as they are at the call. Effort is copied too, which outposts did not do.
- The parent's agent may choose another agent, model, effort and autonomy per piece.
- **Mode cap:** a piece's mode must ask at least as often as the parent's (`aboveParentMode` in `packages/contracts/src/sub-chat-mode-cap.ts`). A proposed mode above the parent's refuses the whole call, naming the piece. When the piece uses another agent, the inherited mode is mapped to that agent's highest mode that is not above the parent's (`cappedMode`). When the parent's effort is not offered by the piece's model, the first offered effort is used (`firstReportedEffort`).
- The user's card edits change model and effort only.
- After the start the sub-chat is the user's: they may change anything in it, including raising its mode. Later changes to the parent do not propagate.
- The values a sub-chat started with are stored on its row for the task card and the audit. When the chat has no model chosen (the parent follows its agent's default), the agent's default at the start (`getCapabilities(...).defaultModel`, the one the context bar shows) is written into the sub-chat's own chat settings as its model, in the transaction that links it (`startedWith` in `start.ts`), and that is the stored model. A turn's model is resolved when the turn starts (`resolveRunTarget`), which for a Held sub-chat is at its release, so without the pin a default that changed in between would run a model the row never showed. The sub-chat therefore keeps that model like a piece whose model was named, and does not follow later changes of the default; the parent, which has no model chosen, still does.

## 5. Authority

- A task, a message from another chat, a reply, a report and a wrap-up are never the user's message in the receiving chat. They cannot authorise a push, a pull request or a Spark action. The receiving chat's own mode and autonomy decide what happens: a sub-chat at Full auto → PR still opens its pull request, and one at Automatic does not because its parent said so.
- Runs they start have run source `chat`. `userWroteTurn`, `userText`, the publish-step reason, the Spark and workflow extra card, the Spark rules session rule, the compaction summary and the chat-started trigger treat `chat` as they treat `assistant` and `workflow`: not the user's. Such a run carries `Run.fromChat` (the sender's title, "another chat" when the ask is gone), and a queued item `QueuedMessage.fromChat`.
- A sub-chat or a turn another chat's message started gets no `spark_sub_chats`. A turn another chat's message started may message only that chat, with one exception: in a turn a sub-chat's report or reply started, the parent may send to (`spark_send_to_chat`) and stop (`spark_stop_chat`) any of its own sub-chats, following its mode. It still may not start new sub-chats or message any other chat in such a turn.
- Text steered into a running turn counts as an untrusted work-data read in the receiving turn (it sets the send flag's note for the rest of that turn). A task or message that starts its own turn is Spark's own record of the chat's work and does not.
- Not offered to spoken runs or child runs. A run started from a paired device may use `spark_sub_chats`, the chat path of `spark_send_to_chat` and `spark_stop_chat` only where the route rules allow that device the matching routes (`POST /api/conversations`, `POST /api/conversations/:id/queue`, `POST /api/runs/:id/cancel`; `deviceRefusal` in `ask-spark-limits.ts`). All three are `always` routes today. The plan card is an ordinary Spark action card.
- Every start and stop (`spark/sub_chat`), every send (the Spark action's own entry, with how it was allowed: mode, card, or the user's message asked) and every reply, report and No reply (`spark/chat_ask`) is an audit entry naming both chats, never the text.
- A test run holds all three tools as "would have been sent" (they are `acts` tools).

## 6. Delivery, and what steering can do

### How the user's own steering works

1. The user's ⌘Enter while a turn runs calls `POST /api/conversations/:id/queue/send-now` (`apps/server/src/api/queue-routes.ts`). `sendNow` in `apps/server/src/workflow/queue-drain.ts` locks the chat; with no active turn it sends the message as an ordinary turn (`outcome: 'sent'`); with one it inserts a `member_messages` row with urgency `now` bound to the running top-level run (`outcome: 'steering'`).
2. The turn's member inbox (`apps/server/src/workflow/member-inbox.ts`, opened in `agent-turn.ts`) polls, claims the row and calls the provider's steer sender.
3. The sender is ACP's custom method `_session/steering` with `idleBehavior: 'promptRequired'` (`apps/server/src/agents/acp/steering.ts`). It is attached only when the agent's `initialize` response carries `_meta.steering.supported`. Both pinned adapters advertise it (Claude and Codex; `docs/architecture/ACP_COMPLIANCE.md`). The outcome `injected` marks the row `delivered`.
4. The steered text is wrapped as `## Message from the user … The user sent this to you directly while you work.` (`messagePrompt`).
5. Fallbacks when the agent does not take it: `'later'` (a background wait is holding) puts the row back to `queued`; otherwise `sendUnsteered` either moves it to the front of `chat_queue` (`queueForLater`, used when it has attachments or sub-agents are still working) or **stops the turn and resends it as the next message** (`interrupt`, then `urgentLeftovers` in `drainQueue`). A row never read is marked `missed` when the turn ends and the user gets **Send again**.
6. `sendNow` refuses to steer anything the user did not type: queue origins `assistant`, `voice`, `pages` and `chat` and Spark rules retries all wait for the chat to be free. The user's Send now on a queued message from another chat is refused with "A message from another chat starts when this chat is free."; Spark steers those itself at delivery.

### How a steered reply is identified

It is not a separate thing. In a solo turn the agent keeps writing the same assistant message; Spark records where the steer landed (`member_messages.delivered_text_offset`, `delivered_text_before`, `delivered_text_held`, migration `0216`) and the web places the user's steered bubble at that point (`apps/web/src/chat/steer/steer-model.ts`). The only separately stored "steer answer" is for crew turns, where a child run carries `answers: <message id>` (`SteerAnswer.tsx`). Nothing marks where the answer to a steer ends.

### Replies

A steered reply cannot be captured cleanly from the stream: after the offset the agent's text is its answer mixed with the rest of its work, and it ends only when the turn ends. So the reply is not read from the stream:

1. **Explicit reply.** The steered text ends with "Answer with spark_send_to_chat, replyTo <ask id>." A `replyTo` call is the reply, delivered at once. This is the only path that gives a prompt reply from a busy chat.
2. **Turn reply.** When the message started its own turn (the receiver was idle, or the message waited in the queue), the reply is that turn's final reply, taken when the run succeeds. 3. **Tail fallback.** A steered ask whose turn ends without a `replyTo` call is settled from the text the turn wrote after the delivery offset, clipped, and ending "(Taken from its turn; that chat did not answer with replyTo.)". If that text is empty the ask ends **No reply**.

A prompt reply from a busy chat therefore depends on its agent calling `replyTo`. Dropping the tail fallback, or not steering asks that want a reply (queue them and use rule 2 only), are both one-line changes in the delivery pass.

### Delivery rules for a message from another chat

- Receiver idle: add to `chat_queue` with origin `chat` and drain; the message starts a turn (run source `chat`).
- Receiver mid-turn: insert a `member_messages` row (urgency `now`) whose id is the ask id. The inbox steers it with a different wrapper: `## Message from the chat "<title>" (not from the user)`, the text marked as data, and the reply instruction when a reply is wanted. The ask is marked delivered (`steer`) only when the agent took the steer; until then its `member_messages` or `chat_queue` row is the hand-over record. Ask rows are left out of the conversation's `memberMessages`, so the web draws no user steer bubble for them.
- If the agent cannot take it now: the row goes to the front of the chat queue (`queueForLater`). A message from another chat **never** takes the `interrupt` path; another chat cannot stop a turn by messaging it. Rows that belong to an ask skip `interrupt` and skip `missed` in `member-inbox.ts` (`sub-chats/steered-ask.ts`): a steer the stopped turn never read goes back to the front of the queue and the ask returns to undelivered.
- Spark pause, an archived receiver and a stopped last turn hold a queued message exactly as they hold other queue items; the ask stays Waiting and the sender's line says why.
- The user can remove a queued message from another chat in the receiving chat's queue strip (not edit it); the ask then ends No reply. A removed message that wanted no reply keeps `state` null and gets `settled_at` and `no_reply_reason`, which is what stops redelivery.
- A wrap-up is always queued, never steered.

### Ask states

Three stored states, for messages sent with `reply: true` and for tasks:

| State    | When                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Waiting  | From creation until a reply or an end.                                                                                                                     |
| Replied  | A reply was recorded (rules 1 to 3).                                                                                                                       |
| No reply | The receiving turn failed or was stopped, the queued message was removed, the receiver was deleted, or a steered turn ended with nothing after the offset. |

A reply and a No reply notice are both `chat_asks` rows of kind `reply` with `reply_to` set; the notice's body is "No reply: <reason>" and the original ask's state tells them apart. Either is delivered to the sender by the same delivery rules: steered when the sender is mid-turn, otherwise it starts a turn. Deleting a chat writes a "No reply: That chat was deleted." notice to each chat with a Waiting ask to it. Only asks of kind `message` are settled from their turn; a task is settled by its report. There is no waiting tool call and no deadline.

### The pass

`sub-chats/delivery.ts` runs one pass in the API process, woken by `sub_chats_changed`, run status changes and Spark pause: requeue missed steers, settle or report ended asks, refresh reports, release Held sub-chats, queue wrap-ups, deliver. `deliver-ask.ts` holds the hand-over itself, so `release.ts` → `start.ts` → `deliver-ask.ts` has no import cycle. An ask's id is the idempotency key at every step, so a restart mid-pass sends nothing twice.

## 7. Reports and the wrap-up

- The task is an ask from the parent to the sub-chat. Its answer is the **report**: a `chat_asks` row of kind `report` from the sub-chat to its parent, `reply_to` the task, with the structured report in `chat_asks.report`; the latest report is also on `sub_chats.report`. The task ask ends `replied` for a succeeded turn and `no_reply` with the reason otherwise. A later message from the parent with `reply: true` is reported the same way when it started its own turn in the sub-chat; steered and answered with `replyTo`, or settled by the tail fallback, it stays a plain reply.
- Spark builds the report when the turn the task started ends. Fixed shape:
  - **Changed**: from the sub-chat's reply.
  - **Branch and pull request**: Spark's own record (branch, committed, pushed, pull request number, state and checks), never the agent's claim.
  - **Risks** and **Blockers**: from the sub-chat's reply.
  - **Also said**: everything else the sub-chat's reply says (`SubChatReport.said`), shown only when there is something.
  - Footer: "Written by the sub-chat's agent, not checked by Spark".
- The task wrapper asks the sub-chat's agent to end its reply with `Changed:`, `Risks:` and `Blockers:` sections. Spark reads those sections; a missing one reads "None stated", and with none of them the reply's opening lines become Changed. A section ends at the next line that looks like a label (`Word:` at the start of a line, plain, bold or after a list bullet, or a Markdown heading), whatever the label is. One exception keeps a section's own list together: while a section whose label line had no text of its own holds only list items, an item that looks like a label (`- Parser: …`) stays in the section; `Changed:`, `Risks:` and `Blockers:` end it wherever they stand. Text before the first section, under any other label, and after the opening lines of a reply with no section goes to Also said, so nothing the agent wrote is dropped (sections are cut at 4,000 characters and Also said at 6,000).
- The report's status is the row's status at that moment: before building it Spark writes the turn's kept-changes record itself (`recordKeptChanges`, which the worker otherwise writes just after the run turns succeeded), so a turn that kept changes reports Ready for review, not Done.
- The branch, committed, pushed and pull request facts are refreshed when Spark commits a sub-chat's kept changes for a stacked start (`refreshReportRecord`): on the row's latest report, on the report sent to the parent, and in that report's text while it has not been handed to the parent. The release step runs before delivery in the pass, so the parent's agent is told "committed" in the usual case; a report already delivered keeps its text and its block is updated. The refresh reads the report, reads git and then writes, and the Start anyway route runs it outside the delivery pass, so both writes are compare-and-swap: `saveSubChatReportRecord` and `rewriteReportAsk` apply only while the stored report still holds what was read, and a refresh that lost to a newer report reads again (three tries, then it leaves the newer report alone). A failed or stopped task turn sends a report with status Needs you and the reason.
- A turn the user typed in a sub-chat, and a pull request follow-up round, update the sub-chat's row (latest report, status) and the Sub-chats tab. They do not start a turn in the parent.
- A sub-chat "has reported" when its row's latest report has no failure reason, so a failed task the user then finishes by typing in the sub-chat releases what waited on it, without a parent turn. A deleted or archived sub-chat counts as reported, so nothing waits on it forever. The pure rules are in `packages/contracts/src/sub-chat-progress.ts` (`subChatProgress`, `canStart`, `planSettled`, `heldReason`).
- **Wrap-up:** when no sub-chat of the parent is Working and none can still start by itself (each has reported, failed or been stopped, or is Held behind one that failed or was stopped), Spark sends the parent one wrap-up: every sub-chat's status with Spark's own branch, commit, push and pull request record, and the order to merge stacked pull requests. It is a `chat_asks` row of kind `wrap_up` with no sender (`from.title` "Spark"). It runs as a read-only reply (`replyToWrapUp` in `sub-chats/wrap-up-turn.ts`: a Do turn becomes an Ask turn), starts no build and no publish step, and authorises no push or pull request at any level or in any mode. A sub-chat is Working for this and for release (`waiting` in `persistence/sub-chat-plans.ts`) while a reply-requesting ask from its parent is waiting, while it has a turn that is queued, running or awaiting approval, or while its last turn succeeded and a queued message or an undelivered ask to it will still start one; a message queued behind a failed or stopped turn does not count, so nothing waits on it forever. It is written once per settled set (`sub_chats.wrapped_up_at`); adding pieces later, or Start anyway on a Held one, allows one more.

## 8. Landing: stacked sub-chats

The stacked-branch rules outposts had are kept, keyed on `sub_chats.stacked_on`:

- A stacked sub-chat's worktree branches from the sub-chat it is stacked on (`stackParentOf` in `orchestration/chat-place.ts`), and its pull request targets that branch while that pull request is open, otherwise the default branch (`prBase`).
- It pushes only its own branch, never force pushes, updates by merge, and is refused a push by `spark_push` and by a gated `git push` while its parent branch is not on the remote (`approvals/publish-policy.ts`, `approvals/stacked-push.ts`, `ship/agent-push.ts`); in a mode the gate cannot see the push is flagged, never stopped (`observations/stacked-push-watch.ts`).
- Every piece that waits (`stackedOn` or a non-empty `startsAfter`) starts Held. A stacked sub-chat stays Held until the one it is stacked on has reported. At Automatic, Spark first commits that sub-chat's kept changes on its own `spark/*` branch (a local commit like Ship → Commit, never pushed); if the commit cannot be made the stacked sub-chat stays Held (`stacked-parent-work.ts`). After the commit that sub-chat's report record is refreshed (section 7).
- `startsAfter` alone is order only. A Held sub-chat starts when everything it waits on has reported. When something it waits on failed or was stopped it stays Held and says so ("Held: “X” did not finish. Start anyway starts it."; one that only waits reads "Waits for “X”."); **Start anyway** on the sub-chat row starts it; for a stacked one the route first makes the same local commit as the release step and answers 409, leaving it Held, when that commit cannot be made. `startHeldSubChat` in `sub-chats/start.ts` is the one way a Held sub-chat starts, for the release step and for the route. An archived Held sub-chat is never started by Spark.
- Stack warnings on the sub-chat row (parent not pushed, behind parent, base merged, base mismatch) are not built (section 14).

## 9. Status

One pure function in `packages/contracts/src/sub-chat-status.ts` maps a sub-chat to one word, first match wins:

| Status           | When                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Held             | Not started yet.                                                                                |
| Needs you        | A card or question is waiting in it, or its last turn failed or was stopped.                    |
| Working          | A turn is running, queued or sleeping, or its task is queued.                                   |
| Ready for review | Its last turn succeeded and it has an open pull request or kept changes not yet merged.         |
| Done             | Its pull request is merged or closed, or it finished with nothing to review, or it is archived. |

The order `subChatStatus` checks is Held, Needs you, Working, archived (Done), Ready for review, Done: an archived sub-chat with an open pull request or kept changes reads Done, and an archived one whose last turn failed still reads Needs you.

Chats that are not sub-chats keep the ordinary sidebar row states. Sub-chat approvals, questions, finished and failed turns are ordinary attention items; no new attention kind is added.

## 10. Data model

Migration `0268_sub_chats.sql`, with `chat_asks.report` from `0269_chat_ask_report.sql`:

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

`0268` also adds `'chat'` to `chat_queue_origin_check` and `runs_source_check`.

Notes:

- `sub_chats` holds the link, the plan (stack, order, held) and the latest report, so no column is added to `conversations` and no chat write path changes. `started_at IS NULL` is Held. The one-level rule is enforced in code under a lock on the parent row: a chat with a `sub_chats` row cannot be a `parent_conversation_id`.
- `parent_title` is written at the start and refreshed by the user's delete path (`leaveDeletedParent`, called from `persistence/conversation-actions.ts`) just before the parent row goes, so "was part of <name>" survives the `SET NULL`. The same statement clears `approval_id`: the plan's approval belongs to a run of the parent and goes with it, and a row updated earlier in the transaction has every foreign key checked again when the cascade sets its parent to null, before the approval's own `SET NULL` has run. Without that the delete failed with `sub_chats_approval_id_fkey`.
- `starts_after` is an array without foreign keys; an id that no longer exists counts as reported.
- An ask's id is reused as the `chat_queue.id`, the `member_messages.id` and the `messages.id` of the turn it starts. That is how the queue, the inbox and the run find their ask without extra columns, and it makes delivery idempotent (`ON CONFLICT (id) DO NOTHING`).
- `state` is null for a message that wants no reply. `from_conversation_id` is null for a wrap-up (Spark wrote it) and after the sender is deleted; `from_title` keeps the name for the line.
- There is no plan table: a waiting plan lives in its approval card's payload, and a started plan is its `sub_chats` rows.
- A parent's summary carries `subChatCount`; a sub-chat with no message yet (Held) is listed and is never pruned as an empty chat.
- A parent is not auto-archived while one of its sub-chats is Held, working or has a message waiting, and a Held sub-chat is not auto-archived (`persistence/inactive-chats.ts`).

Migration `0270_drop_outposts.sql` removed outposts:

- `UPDATE runs SET source = 'chat'` for outpost runs whose post was not typed by the user, and `'queue'` for those whose post was (`outpost_posts.from_user`), then recreate `runs_source_check` without `'outpost'`.
- Delete `chat_queue` rows with `outpost_post_id`, then drop `chat_queue.outpost_post_id` and its index.
- Drop `outpost_story_tasks`, `outpost_drafts`, `outpost_posts`, `outpost_members`, `outposts`.
- Delete the `start_outpost` approval cards and Ask Spark's `post_outpost` cards, answered ones included, with their attention marks: the contracts no longer parse their payloads.
- Drop the outpost triggers on `runs` and `pr_watches` and the outpost functions.
- Former member chats keep their messages, worktrees, branches and pull requests. Their old request turns render as "From another chat · not your message" (`fromChat: 'another chat'`: source `chat` with no ask), and the agent's history labels such a message "Earlier message from another chat". Outpost threads, notes, pins, instructions and drafts went with the tables.

Stored leftovers that stay: `ACTIVITY_SNAPSHOT` run events of type `outpost_draft` stay in the event log, and `spark/outpost_request` and `spark/start_outpost` entries stay in the audit. The audit is a record of what happened and is not rewritten; nothing reads the old events. The MCP server name `spark_outpost` in stored transcripts (`FALLBACK_NAME` in `agents/acp/spark-tools.ts`, `isSparkServer` in `tool-steps.ts`) is the product's name, not the feature, and stays.

## 11. Code shape

`apps/server/src/sub-chats/`:

| Module                                                                        | Does                                                                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `plan.ts`, `plan-facts.ts`                                                    | Validate a `spark_sub_chats` call (pure) and read the facts it needs                                        |
| `start.ts`                                                                    | Create the chats, copy settings, write rows, deliver or hold tasks; `startHeldSubChat`                      |
| `mode-cap.ts`, `proposed-mode.ts`, `chat-posture.ts`                          | Mode cap wording and mode lookup                                                                            |
| `stack-base.ts`, `stack-git.ts`, `stack-publish.ts`, `stacked-parent-work.ts` | Stack base, remote check, pull request base, the local commit before a stacked start                        |
| `asks.ts`                                                                     | Create and settle asks, the send rules of section 3, the ask audit                                          |
| `delivery.ts`, `deliver-ask.ts`, `steered-ask.ts`                             | The pass, the hand-over (steer or queue), the inbox rules for a steered ask                                 |
| `report.ts`, `report-facts.ts`, `reports.ts`                                  | Build the fixed-shape report (pure), read Spark's branch and pull request record, write and refresh reports |
| `release.ts`                                                                  | Start a Held sub-chat when what it waits on has reported                                                    |
| `wrap-up.ts`, `wrap-ups.ts`, `wrap-up-turn.ts`                                | Wrap-up text (pure), queueing it once, its read-only turn                                                   |
| `message-prompt.ts`                                                           | Wrappers for a task, a message, a reply, a report and a wrap-up                                             |
| `availability.ts`                                                             | The `sub_chats`, `chat_messages` and `sub_chat_stop` needs                                                  |
| `user-asked.ts`                                                               | `userText`, `isWrapUp`                                                                                      |

Elsewhere on the server: `spark-mcp/tools/sub-chats-tool.ts`, `tools/ask-spark-tools.ts` (`spark_send_to_chat`, `spark_stop_chat`), `spark-mcp/actions/sub-chats-perform.ts`, `persistence/sub-chats.ts`, `persistence/chat-asks.ts`, `api/sub-chat-routes.ts`.

Contracts (`packages/contracts/src/`): `sub-chats.ts` (pieces, `SubChatRow`, asks, reports, the line texts), `sub-chat-status.ts`, `sub-chat-progress.ts`, `sub-chat-stack.ts`, `sub-chat-mode-cap.ts`, and the action schemas in `start-sub-chats-action.ts`, `send-to-chat-action.ts` and `chat-ref.ts`. The action schemas are separate modules because `spark-actions.ts` importing `sub-chats.ts` closes an import cycle (`approvals` → `spark-actions` → `sub-chats` → `sub-chat-status` → `runs` → … → `setup` → `approvals`); `sub-chats.ts` must stay out of `spark-actions.ts`. The app event is `sub_chats_changed`.

Web: `apps/web/src/conversations/` (`SubChatRows.tsx`, `sub-chat-tree.ts`, `deleted-chat-cache.ts`, `ParentMark.tsx`, `SubChatStatusWord.tsx`), `apps/web/src/chat/sub-chats/` (`StartedLine.tsx`, `ChatTurnStart.tsx`, `TaskCard.tsx`, `ReportBlock.tsx`, `AskLines.tsx`, `ask-lines.ts`), `apps/web/src/chat/approvals/SubChatsPlanFacts.tsx` and `apps/web/src/tasks/` (`SubChatsPane.tsx`, `sub-chats-pane.ts`, `use-sub-chats.ts`; query key `['sub-chats', parentId]`, refreshed whenever the chat list is). Lines are drawn from `detail.asks` by run: the sender's line for a `message` ask whose `fromRunId` is in the turn, the receiver's line for an ask steered into the turn.

Delivery runs in the API process (`api/main.ts`); the worker needs only `stackGit` in its Spark tool deps. A2A is not used: nothing here needs an agent protocol between two chats in one process, so `@a2a-js/sdk` is removed. Should chats on different machines ever talk, that is the time to add a protocol.

### Routes

| Route                                                    | Use                                 | Paired device                                                                   |
| -------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/conversations/:id/sub-chats`                   | Sub-chat rows for the Sub-chats tab | Allowed with reading chats                                                      |
| `POST /api/conversations/:id/sub-chats/:subChatId/start` | Start anyway                        | Allowed with sending messages (the rule of `POST /api/conversations/:id/queue`) |

Everything else rides existing routes: the conversation list and detail carry `parent`, `formerParent`, `subChat`, `subChatCount`, `asks` and `subChatStarts`; the plan card is answered through the approvals route; the queue routes remove a queued message. Both routes have their line in `apps/server/src/remote/route-rules.ts`.

## 12. What was removed

- Outposts: `apps/server/src/outposts/`, `apps/server/src/a2a/`, the outpost routes, tables, tools (`spark_outpost`, `spark_outpost_ask`, `spark_outpost_note`, `spark_outpost_draft`, `spark_outpost_start`, Ask Spark's `spark_post_outpost`), `apps/web/src/outposts/`, `apps/web/src/chat/outpost/`, the outpost page, handles, notes, pins, instructions, drafts and the library tab, the browser specs and the five guide pages.
- A2A: `@a2a-js/sdk`, the two `/api/a2a/` routes and their contract tests. `PROTOCOL_ALIGNMENT.md` no longer claims A2A support.
- Rules that only outposts had: a request the user typed in an outpost counting as the user's message (the user now types in the chat itself), Spark pause letting such a request through, a queued message starting after a stopped turn because it was posted later, and the standing assigned-work fact on every turn of a story's sub-chat (a sub-chat gets the note on its task turn only).
- Not the feature, and kept: the product name in every spelling ("Here's your outpost" in onboarding, "Outpost's safety rules" in the trust cards, the `codex-outpost` blob seed), the MCP server name `spark_outpost`, database names, old migrations, `releases/` and the historical changelog line.

## 13. Decisions

Taken in planning and while building, in the order they came up. "Owner" marks a decision the owner made; the rest were taken by the builder and are open to change.

### Behaviour

1. **Only the agent starts sub-chats, one level, no caps** (owner). No menu item, no manual add, no adopting an existing chat.
2. **`spark_sub_chats` needs a project on the parent chat**, so a chat with no project does not pay for the tool.
3. **`startsAfter` is a list**; `stackedOn` is one sub-chat and implies waiting for it. Every piece that waits starts Held.
4. **"Done" for releasing a Held sub-chat means "has reported"**, not "pull request merged": a stacked sub-chat must be able to start while the pull request it builds on is still open.
5. **"Has reported" is read from the sub-chat's row** (a report with no failure reason), so a failed task the user finishes by typing in the sub-chat releases what waited on it without a parent turn.
6. **A Held sub-chat stops waiting for one that was deleted or archived.** The design was silent on archived; an archived sub-chat counts as reported whatever its last turn did, and an archived Held sub-chat is never started by Spark.
7. **A piece that fails to start takes the piece stacked on it with it**; a `startsAfter` on a piece that did not start is dropped.
8. **Reports start a parent turn only for the task (or a later parent ask that started its own turn).** Turns the user typed in a sub-chat and follow-up rounds update the row silently, so chatting in a sub-chat does not keep waking the parent.
9. **Risks and Blockers come from labelled sections of the sub-chat's reply**; branch and pull request come from Spark's record. Missing sections read "None stated".
10. **A task always ends in a report**: `replyTo` on a task is refused.
11. **Steered replies are not read from the stream.** The reply is an explicit `replyTo` call, else the reply of the turn the message started, else the text after the steer's offset when the turn ends, else No reply.
12. **A message from another chat never stops a turn.** The user's own steer may stop the turn and resend; a chat's message goes to the queue instead.
13. **The user's Send now on a queued message from another chat is refused**, as it is for Ask Spark's messages; Spark steers those itself at delivery.
14. **Sending between a sub-chat and its parent:** parent → sub-chat follows the mode; in a turn the parent's message started, the sub-chat may message the parent (the same-chat rule); in a turn the user typed in the sub-chat, messaging the parent is "any other chat" and needs the user's words or a card.
15. **"Any chat → any other chat" shows a card in every mode** when the user's message did not ask and name the chat, Bypass permissions and Full access included, as Ask Spark's card answers do.
16. **"No chains" exempts a parent messaging its own sub-chats** (owner). In a turn a sub-chat's report or reply started, the parent may `spark_send_to_chat` any of its own sub-chats and `spark_stop_chat` them, following its mode. It still may not start new sub-chats or message any other chat. A parent and its sub-chats can therefore exchange messages for as long as their agents keep going, with no cap; the user stops it with Stop.
17. **The plan card edits model and effort only.** Mode is not editable there; the user raises a mode in the sub-chat.
18. **A proposed mode above the parent's refuses the whole call**; an inherited mode is mapped down for another agent.
19. **One run source, `chat`**, for every turn started by a task, message, reply, report or wrap-up. It counts wherever `assistant` and `workflow` count as not the user's.
20. **The five-word status applies to sub-chats only.** Other chats keep the ordinary sidebar states.
21. **A failed or stopped turn reads Needs you** with the reason.
22. **An archived sub-chat reads Done before Ready for review** (found while building, owner to confirm): one with an open pull request or kept changes reads Done; one whose last turn failed still reads Needs you.
23. **A parent is not auto-archived** while a sub-chat is Held, working or has a message waiting; a Held sub-chat is not auto-archived.
24. **A receiver deleted while an ask waits** gives the sender a "No reply: That chat was deleted." notice.
25. **The wrap-up is always queued, never steered**, and Start anyway after a wrap-up allows one more.
26. **The split guidance is a fact of the chat, not of the turn**, so the session prompt stays the same across turns; `spark_sub_chats` itself is not offered to a turn another chat's message started, so such a turn reopens the session.
27. **Steering text the user did not type is new.** The steered text sits inside a turn the user started, so the backend's "the user's message asks for it" checks still read the turn's first message; the wrapper labels the text as another chat's and it sets the send flag.

### Data and migration

28. **The link lives in a `sub_chats` table, not in a `conversations` column**, so no chat write path changes and deleting a sub-chat cleans up by cascade.
29. **No plan table.** A waiting plan is its approval card's payload; a started plan is its rows. The wrap-up's once-only mark is `sub_chats.wrapped_up_at`.
30. **A report is a `chat_asks` row of kind `report`** with the structured report in `chat_asks.report` (migration `0269`); a reply and a No reply notice are both rows of kind `reply`.
31. **Outposts are deleted with no deprecation** (owner). Former member chats stay as plain chats; old request turns stay in transcripts and read "From another chat · not your message". Old `outpost` runs are remapped to `chat`, or to `queue` when the user typed the request in the outpost.
32. **`0270_drop_outposts.sql` deletes every `start_outpost` and Ask Spark `post_outpost` approval card, answered ones included**, with their attention marks. Expiring only the pending ones would leave payloads the contracts no longer parse, and one such card fails the whole chat's detail in the web app. It also drops the four outpost triggers and five functions before the tables, since they would fail every run insert afterwards.
33. **Stored `outpost_draft` run events and `spark/outpost_request` audit entries stay.** The audit is a record and is not rewritten.
34. **A2A is removed, not kept dormant** (`@a2a-js/sdk` leaves `package.json`), per `AGENTS.md`'s rule against wrapping internals in a protocol without a current need.
35. **Deletion order was web, then server**, so typecheck held at each step.

### UI

36. **The tab is named Sub-chats** (owner). The Work panel's **Plan** tab (the agent's agreed plan) keeps its name; contract names follow (`SubChatRow`).
37. **A parent with no task of its own** shows the rows under a **Sub-chats** heading, since the tab strip belongs to a task.
38. **Empty groups are not shown** in the tab.
39. **A sub-chat row in the sidebar wraps its status under the title** instead of cutting the title; a folded parent unfolds when one of its sub-chats becomes the selected chat.
40. **An exchange is one ask that is not a reply**; two or more with one chat in a turn collapse. Tasks, reports and replies a chat sent get no line of their own in that chat.

### Docs and tools

41. **The guide has three pages**: `sub-chats.md` (concept), `split-into-sub-chats.md` (how-to) and `sub-chat-reports.md`, because each is at its word cap; `stacked-pull-requests.md` is rewritten for sub-chats.
42. **Tool budget:** the plain-chat cap in `spark-tool-budget.test.ts` rose from 27,000 to 27,800 characters for `spark_send_to_chat`, and the instructions cap fell from 1,800 to 1,650 (section 3, Tool sizes).
43. **The delegation line keeps the word "lead"** for an agent leading its own provider sub-agents; it never meant an outpost's lead chat. The assigned-work line for a task turn says "the chat that assigned it".

### After the first real end-to-end run

44. **A report keeps the sub-chat's whole reply**: three labelled sections and an Also said part for the rest.
45. **A report's status is taken after the turn's kept record is written**, and its branch record is refreshed when Spark commits for a stacked start.
46. **The send check has its own reading of "wait"**: "…and wait for its reply" is not a hold-back for `spark_send_to_chat`; Ask Spark's card answers keep the stricter list.
47. **A parent's delete clears its sub-chats' link to the plan card** instead of changing the foreign key, which was already `ON DELETE SET NULL` (section 10).

### After review of the fixes

48. **A sub-chat started from a chat with no model chosen is pinned to the agent's default at the start** (section 4), so a Held sub-chat runs with the model its row showed. The alternative, recording the model at release, would let the row change under the user.
49. **The record refresh never overwrites a newer report**: its writes are compare-and-swap with a bounded retry (section 7), not a row lock held across the git read.
50. **A bulleted or bold label the parser does not know ends a section**, except inside a section's own list (section 7).
51. **The web rewrites its cached lists when a parent's delete finishes** (section 2) instead of waiting for the refetch.

## 14. Not built

- A user entry point for starting, adding or adopting sub-chats.
- Nesting deeper than one level, and a sub-chat with two parents.
- One combined pull request, and any merge by Spark.
- A needs-you queue above the parent's message box.
- Stack warnings on a sub-chat row (parent not pushed, behind parent, base merged, base mismatch): `SubChatRow` carries no stack facts and they need git reads per row. The push refusal and the observed-rail flag still hold.
- Messages to or from Terminal sessions; `@all`; notes that start nothing; pinned notes; shared instructions; a library tab.
- A blocking "ask and wait" tool call. Replies arrive as a later turn or a steer.
- A cost roll-up across sub-chats, and a combined Agent TV stage.
- Any agent protocol between chats (A2A is removed).
- Not covered by a check: the browser specs seed rows and cards against the real server, and no spec drives a fake-provider split end to end (the db tests `sub-chats-e2e.db.test.ts` and `chat-asks-e2e.db.test.ts` do). A split by a real Claude chat is not a CI check.
