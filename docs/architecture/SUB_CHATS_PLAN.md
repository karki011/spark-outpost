# Sub-chats: build plan

> **Status: plan, nothing built (November 20, 2026).** Design: `SUB_CHATS.md`. Mock: `docs/design/mocks/sub-chats-mock.html` and `.png`. All work lands on the branch `sub-chats`. Read `AGENTS.md` first: no explanatory code comments, plain user-facing wording, handwritten files at or below 500 lines, no caps, budgets or timers.

## How to work the slices

- Nine slices. Each ends with the app building and `pnpm check` passing (format, lint, typecheck, source rules, guide rules, knip, unit tests). Do not run the full `pnpm test:db` or `pnpm test:browser`; push and let CI run them, and use `pnpm test:changed`, `pnpm test:db:changed` and `pnpm test:browser:changed` for the inner loop.
- knip fails on an export nothing imports. A slice only adds an export that code or a test in the same slice uses.
- `pnpm check:docs` fails when a Spark tool or a UI label has no guide entry and when a link points at a page that is gone. Each slice lists its guide changes; every user-visible change adds a row to `docs/guide/whats-new.md`.
- A new route needs its line in `apps/server/src/remote/route-rules.ts` in the same slice or the policy test fails.
- A new browser spec is added to `tests/browser/spec-map.ts` in the same slice or the unit tests fail.
- Outposts keep working until slice 7. New code must not import from `apps/server/src/outposts/`, `apps/server/src/a2a/` or `apps/web/src/outposts/` except where a slice says a file is moved (move it, then fix the old importers).

### Order and what can run at the same time

```
1 ──► 2 ──► 3 ──► 4 ──► 6 ──► 7 ──► 8 ──► 9
 └──► 5 (beside 2, 3 and 4)
```

| Slice | One line                                                                             | Runs beside             |
| ----- | ------------------------------------------------------------------------------------ | ----------------------- |
| 1     | Schema, contracts, read model, Plan route                                            | nothing (first)         |
| 2     | Messages between chats on the server: asks, delivery, steering, `spark_send_to_chat` | 5                       |
| 3     | `spark_sub_chats`: plan card, start, settings, stacks, stop, tracking                | 5                       |
| 4     | Reports, releasing Held sub-chats, the wrap-up                                       | 5                       |
| 5     | Web: sidebar tree, flattened markers, breadcrumb, status                             | 2, 3, 4                 |
| 6     | Web: Plan tab, plan card, task card, report block, message lines                     | nothing (needs 4 and 5) |
| 7     | Delete outposts from the web, the browser specs and the guide                        | nothing                 |
| 8     | Delete outposts and A2A from the server and contracts; drop migration                | nothing                 |
| 9     | Dead-code sweep, `AGENTS.md`, architecture docs                                      | nothing                 |

Slices 2, 3 and 4 are one chain on the server. Slice 5 touches only `apps/web/src/conversations/`, `apps/web/src/chat/project/` and its own tests, so it runs in its own worktree beside them and is merged back before slice 6. The only files two parallel slices both touch are `docs/guide/whats-new.md` and `tests/browser/spec-map.ts`, where each adds lines.

---

## Slice 1: schema, contracts and read model

**Goal.** The tables exist, the shapes are fixed for every later slice, and a chat's parent and sub-chats can be read. Nothing can create a sub-chat yet; tests insert rows.

**Add**

- `apps/server/migrations/0268_sub_chats.sql`: `sub_chats`, `chat_asks`, `'chat'` added to `chat_queue_origin_check` and `runs_source_check` (design section 10). If `main` has taken `0268`, use the next free number.
- `packages/contracts/src/sub-chats.ts`: schemas and types for a plan piece, the `start_sub_chats` action payload, a Plan row, an ask, a report, the `ConversationSummary` fields `parent`, `formerParent`, `subChat` and the detail field `asks`; the line texts ("Started N sub-chats: …", "Asked X: …", "From X: …", "N exchanges with X"). Export through `index.ts`.
- `packages/contracts/src/sub-chat-status.ts`: `subChatStatus(facts)` returning one of the five words, and the group order for the Plan tab.
- `apps/server/src/persistence/sub-chats.ts`: insert, list by parent, read one, mark started, save report, refresh `parent_title`.
- `apps/server/src/persistence/chat-asks.ts`: insert, read, list for a chat, mark delivered, settle.
- `apps/server/src/api/sub-chat-routes.ts`: `GET /api/conversations/:id/sub-chats`.

**Change**

- `apps/server/src/persistence/summary-query.ts`, `rows.ts`, `conversations.ts`: summaries carry `parent`, `formerParent` and `subChat` (status facts); detail carries `asks`.
- `apps/server/src/persistence/conversation-actions.ts`: the delete path refreshes `sub_chats.parent_title` before deleting a parent.
- `apps/server/src/persistence/inactive-chats.ts`: a parent is not auto-archived while one of its sub-chats is Working or Held.
- `packages/contracts/src/app-events.ts`, `apps/web/src/app/live/app-event-keys.ts`, `apps/desktop/src/attention-feed.ts`: new event `sub_chats_changed` (keep `outpost_changed` until slice 8).
- `apps/server/src/api/app.ts`, `apps/server/src/remote/route-rules.ts`: mount the route; allow it wherever reading chats is allowed.
- `tests/browser/database.ts`: add the two tables to the reset list.

**Tests**

- Unit: `sub-chat-status.test.ts` (every status, first match wins, a deleted parent), `sub-chats.test.ts` (schemas, line texts, singular and plural).
- `pnpm test:db`: `sub-chats.db.test.ts` (rows by parent in order, parent delete keeps the sub-chat with the title, sub-chat delete cascades, one level enforced by the store), `chat-asks.db.test.ts` (idempotent insert, settle once), `migrate-startup.db.test.ts` still passes, `archive-inactive.db.test.ts` gains the parent case, `remote-policy.db.test.ts` and `remote/policy.test.ts` gain the route.

**Docs.** None user-visible.

**Done when** a seeded parent with three sub-chats returns the right rows and statuses from the route and the chat list, and `pnpm check` passes.

---

## Slice 2: messages between chats (server)

**Goal.** A chat's agent can send another chat a message, ask for a reply and answer one. Delivery steers into a running turn, starts a turn in an idle chat, and queues when the agent can't take it.

**Add** (`apps/server/src/sub-chats/`)

- `asks.ts`: who may send to whom (design section 3 table), creating an ask, recording a reply (`replyTo`), ending an ask No reply.
- `delivery.ts`: one pass woken by `sub_chats_changed`, run status changes and `spark_pause`: settle Waiting asks whose run ended (turn reply or tail fallback), deliver undelivered asks (active turn: `insertMemberMessage` with the ask id; idle: `addToQueue` with origin `chat`, then `drainQueue`). Started and closed from `apps/server/src/api/main.ts` beside the outpost dispatcher.
- `message-prompt.ts`: the wrappers for a message that starts a turn and for a steered message (heading "Message from the chat …, not from the user", text marked as data, the reply instruction).
- `availability.ts`: the `chat_messages` need.
- `user-asked.ts`: move `userText` and the wrap-up check from `outposts/user-asked.ts`; update its five importers.

**Change**

- `apps/server/src/spark-mcp/tools/ask-spark-tools.ts`: `spark_send_to_chat` loses `assistantOnly`, gains `reply` and `replyTo`, and picks Ask Spark's path or the chat path by `scope.assistant`. `spark-mcp/server.ts`, `tool.ts`, `availability.ts`: the new need.
- `packages/contracts/src/spark-actions.ts`: action `send_to_chat` with labels; `spark-mcp/actions/action-policy.ts`: its request pattern, the names-the-chat check (reuse `namesChat`), and run source `chat` counted as not the user's in `runFacts` and `userWroteTurn`; `actions/perform.ts`: perform it; `actions/ask-spark-limits.ts`: route for the paired-device check.
- `apps/server/src/workflow/member-inbox.ts`: a claimed row that is an ask uses the chat wrapper, never takes `interrupt`, is queued instead of marked `missed`, and records the untrusted read through the run's observations when delivered. Keep the file under 500 lines; move the ask handling to `sub-chats/steered-ask.ts` if needed.
- `apps/server/src/workflow/queue-drain.ts`: origin `chat` maps to run source `chat`; the user's own Send now on such an item is refused with "A message from another chat starts when this chat is free."
- `apps/server/src/persistence/chat-queue.ts`, `conversations.ts`, `packages/contracts/src/crew-messages.ts`: origin and source `chat`; a queued message from a chat can be removed, not edited.
- `apps/server/src/workflow/run-input.ts`, `agent-turn.ts`: a run started by an ask loads it and gets the wrapper as its turn preamble.
- `apps/server/src/spark-mcp/actions/rules-edit-session.ts`, `apps/server/src/compaction/summary.ts`, `apps/server/src/crew-flows/chat-started.ts`: treat source `chat` as not the user's.
- Web, the minimum to typecheck and not mislead: `apps/web/src/chat/approvals/SparkActionCard.tsx` facts for `send_to_chat`; `apps/web/src/chat/queue/queue-model.ts` tag "From <chat>"; a turn with source `chat` shows "From <chat> · not your message" instead of a user bubble (full lines come in slice 6).
- Audit entries for send, reply and No reply naming both chats.

**Tests**

- Unit: send rules table (`asks.test.ts`), wrappers (`message-prompt.test.ts`), `action-policy.test.ts` (asked and names the chat; a question mark or a negation does not count), `tool-selection.test.ts` (offered to a chat turn; not to a child, spoken, read-only or Terminal run; Ask Spark keeps its own path).
- `pnpm test:db`: `chat-asks-delivery.db.test.ts` (idle starts a turn with source `chat`; busy steers; a fake agent that refuses the steer leaves the message at the front of the queue and the turn is not stopped; duplicate delivery passes send once; a restart mid-delivery resends nothing twice; Spark pause and an archived receiver hold it), `chat-asks-reply.db.test.ts` (`replyTo` settles and is delivered back; turn reply on success; tail fallback; failed, stopped and removed end No reply; the reply never counts as the user's message for a push, a pull request or a Spark action), `steer-fallback.db.test.ts` and `steer-stop.db.test.ts` still pass for the user's own steers, `spark-tool-budget.test.ts` (re-run `pnpm exec tsx scripts/spark-tool-budget.ts`; keep the plain-chat case under its cap by keeping the description short).
- Browser: none new (covered in slice 6).

**Docs.** `docs/guide/spark-tools.md` (move `spark_send_to_chat` out of the Ask Spark only table, say who may send to whom), `docs/guide/guardrails.md` (another chat's text is never your message), `docs/guide/whats-new.md`.

**Done when** two real chats on the fake provider exchange an ask and a reply in all three delivery cases, the receiving turn's audit shows the untrusted read for a steer, and `pnpm check` passes.

---

## Slice 3: `spark_sub_chats` (server)

**Goal.** A chat's agent starts sub-chats with one call: at once in modes that act, otherwise one plan card. Sub-chats copy settings, stack correctly, and can be stopped and tracked by the parent.

**Add** (`apps/server/src/sub-chats/`)

- `plan.ts`: validate a call (unique titles, references, no cycle, same repository for `stackedOn`, projects, agent, model, effort, mode, mode cap). Pure.
- `start.ts`: per piece create the chat, copy agent, model, effort, mode and autonomy, set the title, insert the `sub_chats` row with `started_with`, then create the task ask (slice 2) or leave it Held. A stacked piece is always Held until slice 4 releases it.
- `mode-cap.ts`, `proposed-mode.ts`, `chat-posture.ts`: moved from `outposts/` (fix the outpost importers), wording by title instead of handle.
- `stack-base.ts`, `stack-publish.ts`: new lookups keyed on `sub_chats.stacked_on`. `stack-git.ts`, `git-read-cache.ts`: moved from `outposts/`.
- `apps/server/src/spark-mcp/tools/sub-chats-tool.ts`: `spark_sub_chats`.
- `apps/server/src/spark-mcp/actions/sub-chats-perform.ts`: perform `start_sub_chats` (applying the card's model and effort edits) and `stop_sub_chat`.
- `packages/contracts/src/sub-chat-mode-cap.ts`, `sub-chat-stack.ts`: moved from `outpost-mode-cap.ts`, `outpost-stack.ts` and the stack and order parts of `outpost-story.ts`; the outpost modules import from them until slice 8.

**Change**

- `spark-mcp/server.ts`: register the tool, add it to `CHAT_TURN_ONLY`; `tool.ts`, `availability.ts`, `sub-chats/availability.ts`: needs `sub_chats` and `sub_chat_stop`.
- `packages/contracts/src/spark-actions.ts`: actions `start_sub_chats` (editable: per-piece model and effort) and `stop_sub_chat`; `action-policy.ts`: request patterns (replace `start_outpost`'s nouns; keep `start_outpost` until slice 8).
- `tools/ask-spark-tools.ts`: `spark_stop_chat` offered to a parent for its own sub-chats (chat path), Ask Spark's path unchanged.
- `tools/chat-tools.ts`: `spark_chats` filter `my_sub_chats`, `parent`, `subChats`; `spark_chat` parent and sub-chat fields.
- `apps/server/src/orchestration/chat-place.ts`, `apps/server/src/workflow/publish-context.ts`: ask the sub-chats stack lookup first, the outpost one second (the fallback goes in slice 8).
- `apps/server/src/workflow/chat-prompt-text.ts`, `chat-prompt.ts`, `chat-turn-prompt.ts`, `apps/server/src/agents/delegation-policy.ts`: the split guidance of design section 3, shown when `spark_sub_chats` is offered; the assigned-work line for a task turn.
- `apps/server/src/api/sub-chat-routes.ts`: `POST /api/conversations/:id/sub-chats/:subChatId/start` (Start anyway) with its route rule.
- The "Started N sub-chats: a, b, c" line as a run activity on the parent's turn; audit entries per start and stop.
- Web, the minimum to typecheck: `SparkActionCard.tsx` shows the plan card's rows as plain facts (the editable card comes in slice 6).

**Tests**

- Unit: `plan.test.ts` (each refusal, the mode cap across agents, effort fallback), `sub-chat-stack.test.ts` and `sub-chat-mode-cap.test.ts` (moved cases), `tool-selection.test.ts` (not offered to a sub-chat, a turn another chat's message started, a child, spoken or read-only run, Ask Spark or a Terminal session), `chat-prompt.test.ts` and `chat-turn-prompt.test.ts` (guidance present only with the tool).
- `pnpm test:db`: `sub-chats-start.db.test.ts` (at once in Auto; a card otherwise, and Start, Discard and edited model and effort; settings copied including effort; a piece with another agent gets a capped mode; one failing piece does not stop the rest; a second identical approval starts nothing twice; a sub-chat calling the tool is refused; a second call adds pieces), `sub-chats-stack.db.test.ts` (worktree base, pull request base, push refused while the parent branch is not on the remote: move the cases from `stack-base.db.test.ts`, `stack-publish.db.test.ts`), `sub-chats-stop.db.test.ts` (own sub-chat only), `spark-mcp-availability.db.test.ts`, `spark-tool-budget.test.ts`, `remote-policy.db.test.ts`.

**Docs.** New `docs/guide/sub-chats.md` (what a parent and a sub-chat are, that only the agent starts them, what a sub-chat starts with, the plan card), `docs/guide/spark-tools.md` (`spark_sub_chats`, `spark_stop_chat`, tracking fields), `docs/guide/README.md` index, `whats-new.md`.

**Done when** a chat on the fake provider starts three sub-chats (one stacked, one starting after two others) both at once and through the card, the stacked one's worktree is based on its parent sub-chat's branch after Start anyway, and `pnpm check` passes.

---

## Slice 4: reports, Held release and the wrap-up (server)

**Goal.** A finished sub-chat reports to its parent, Held sub-chats start when what they wait on has reported, and the parent writes one read-only wrap-up.

**Add** (`apps/server/src/sub-chats/`)

- `report.ts`: build the fixed-shape report from the task turn's reply (the `Changed:`, `Risks:`, `Blockers:` sections, "None stated" when missing) and Spark's own branch, commit, push and pull request record. Pure, with the facts read in `report-facts.ts` (from `outposts/story-view.ts`).
- `release.ts`: start a Held sub-chat when everything it waits on has reported; keep it Held when one failed or was stopped.
- `stacked-parent-work.ts`: moved from `outposts/`, keyed on `sub_chats`: at Automatic, commit the kept changes of the sub-chat it is stacked on before it starts; stay Held if the commit cannot be made.
- `wrap-up.ts`, `wrap-up-turn.ts`: moved from `outposts/story-wrap-up.ts`, `story-wrap-ups.ts`, `wrap-up-turn.ts`, wording by title.

**Change**

- `sub-chats/delivery.ts`: the pass gains report, release and wrap-up steps, in that order, before delivery.
- `sub-chats/message-prompt.ts`: the task wrapper asks for the three sections; the report and wrap-up wrappers.
- `apps/server/src/workflow/chat-turn.ts`, `publish-context.ts`, `publish-step-reason.ts`: the wrap-up check reads the ask kind (keep the outpost check beside it until slice 8).
- Turns the user typed in a sub-chat and follow-up rounds refresh `sub_chats.report` without starting a parent turn.

**Tests**

- Unit: `report.test.ts` (sections, missing sections, a reply with none, a failed turn), `wrap-up.test.ts` (moved cases, merge order for a stack).
- `pnpm test:db`: `sub-chats-report.db.test.ts` (report delivered once per task turn; steered into a busy parent; a restart between turn end and report delivers it once; a report-started parent turn may message only that sub-chat and gets no `spark_sub_chats`), `sub-chats-release.db.test.ts` (released after all reports; Held behind a failure; Start anyway; Spark pause holds; the local parent commit at Automatic and the blocked case: move from `stacked-parent-work.db.test.ts` and `dependency-release.test.ts`), `sub-chats-wrap-up.db.test.ts` (one wrap-up when settled, read-only turn, no publish step at Full auto → PR and in Auto, one more after pieces are added).

**Docs.** `docs/guide/sub-chats.md` (reports, Held and Start anyway, the wrap-up), `docs/guide/stacked-pull-requests.md` rewritten for sub-chats, `docs/guide/statuses-and-limits.md` (the five words), `whats-new.md`.

**Done when** the three-piece plan from slice 3 runs end to end on the fake provider: two reports, the Held piece starts by itself, three reports, one wrap-up, nothing pushed by the wrap-up; `pnpm check` passes.

---

## Slice 5: web tree and header (beside slices 2 to 4)

**Goal.** Sub-chats are nested under their parent in the sidebar, flattened lists mark them, and a sub-chat's header leads back to its parent.

**Add** (`apps/web/src/conversations/`)

- `SubChatRows.tsx`, `sub-chat-rows.css`, `sub-chat-tree.ts`: the tree with connector lines, plan order, fold state, the parent's needs-you count, the five-word status as icon plus word.
- `ParentMark.tsx`: "↳ <parent>" and "· was part of <name>" for flattened rows.

**Change**

- `sidebar-groups.ts`, `sidebar-projection.ts`, `ChatRows.tsx`, `ActiveChats.tsx`, `ConversationList.tsx`: a sub-chat is listed under its parent and not again under its project; drag and drop, number keys and row focus keep working (a sub-chat is not draggable out of its parent).
- `HistoryChats.tsx`, `LooseChats.tsx`, search results, Home rows, `apps/web/src/island/island-rest-line.ts`, `packages/contracts/src/attention-report.ts`: the flattened marker and "<sub-chat> in <parent> needs you" wording.
- `apps/web/src/chat/project/ContextBar.tsx` (and the phone context bar): breadcrumb "‹ <parent> / <sub-chat>" and the status.

Leave `OutpostGroup.tsx`, `OutpostRows.tsx` and `outpost-members.ts` alone; slice 7 deletes them.

**Tests**

- Unit: `sub-chat-tree.test.ts` (order, fold, count, a deleted parent, an archived sub-chat), `SubChatRows.test.tsx` (keyboard, focus, status word and icon), `sidebar-groups.test.ts` and `sidebar-projection.test.ts` cases.
- Browser: `tests/browser/sub-chats-sidebar.spec.ts` seeded with rows (tree, fold, open a sub-chat, breadcrumb back, History and search markers, parent deleted, phone width); add a `sub-chats` group and its path prefixes to `tests/browser/spec-map.ts`.

**Docs.** `docs/guide/sub-chats.md` section "Find a sub-chat" (create the page with this section if slice 3 has not merged yet; slice 3's text wins on conflict), `whats-new.md`. Apple check: tree rows are a standard outline (disclosure triangle, arrow keys left and right fold and unfold), status is an icon plus a word, text is at least 12px.

**Done when** the seeded tree matches the mock's sidebar and flattened panel in light and dark, with keyboard and VoiceOver labels checked, and `pnpm check` and `pnpm test:browser:changed` pass.

---

## Slice 6: web Plan tab, cards and lines

**Goal.** Everything else in the mock: the Plan tab, the plan card with model and effort pickers, the task card, the report block and the lines for messages between chats.

**Add**

- `apps/web/src/chat/sub-chats/`: `StartedLine.tsx`, `TaskCard.tsx`, `ReportBlock.tsx`, `AskLines.tsx` (with the collapsed "N exchanges with X"), `ask-lines.ts`, `sub-chats.css`.
- `apps/web/src/chat/approvals/SubChatsPlanFacts.tsx`: the plan card (rows, **Edit** pickers for model and effort, **Show each task**), sending the edits with the approval.
- `apps/web/src/tasks/SubChatsPane.tsx`, `sub-chats-pane.ts`, `use-sub-chats.ts`: the Plan tab (groups, rows, stack warnings, **Open**, **Start anyway**).

**Change**

- `apps/web/src/tasks/TaskDetails.tsx`, `WorkPanel.tsx`: tab id `sub-chats` labelled **Plan**, shown for a chat that has or had sub-chats even when it has no task of its own; the existing agreed-plan tab is relabelled **Agreed plan** (see Decisions).
- `apps/web/src/chat/TurnSection.tsx`, `SparkActionCard.tsx`, `chat/queue/queue-model.ts`, `chat/retry-turn.ts`: render the new items; a turn another chat's message started offers no Retry as the user.
- `apps/web/src/app/live/app-event-keys.ts`: `sub_chats_changed` refreshes the parent's Plan query and both chats' details.
- Paired devices see the same Plan tab and lines; **Start anyway** follows its route rule; the plan card follows the ordinary card rules.

**Tests**

- Unit: `ask-lines.test.ts` (states, collapsing, a deleted chat), `sub-chats-pane.test.ts` (grouping and order), `SubChatsPlanFacts.test.tsx` (pickers, keyboard, edits payload), `TaskCard.test.tsx`, `ReportBlock.test.tsx`.
- Browser (fake provider, real server): `tests/browser/sub-chats.spec.ts` (ask the agent to split: the line, the tree, the Plan tab, a report, the wrap-up), `sub-chats-card.spec.ts` (plan card in Manual: edit a model, Start, Discard), `sub-chats-messages.spec.ts` (ask and reply lines in both chats, steered and queued), `sub-chats-phone.spec.ts` (paired phone reads the Plan and answers the card); add all to `spec-map.ts`. Streaming and background refresh must keep focus and scroll position in the Plan tab.

**Docs.** `docs/guide/sub-chats.md` completed, `docs/guide/cards.md` and `answer-approvals.md` (plan card), `context-rail.md` or the page that documents the Work panel tabs (Plan, Agreed plan), `follow-a-turn.md` (message lines), `use-your-phone.md`, `whats-new.md`; screenshots through `pnpm docs:screenshots` if the guide page shows any.

**Done when** the three screens of the mock (parent with Plan, plan card, sub-chat) exist against the real server on the fake provider, in light and dark and at phone width, and `pnpm check` and `pnpm test:browser:changed` pass. A real Claude chat splitting a small job is run once and its result reported (owner's "test for real" rule); that run is evidence, not a CI check.

---

## Slice 7: delete outposts from the web, browser specs and guide

**Goal.** No outpost UI remains. The server still serves the routes; nothing calls them.

**Delete**

- `apps/web/src/outposts/` (after moving `post-text.ts`'s `webLink` to `apps/web/src/links/web-link.ts` for the three GitHub importers, and the chat fixtures in `test-fixtures.ts` that island, phone, calendar and desktop tests import to `apps/web/src/test/chat-fixtures.ts`).
- `apps/web/src/chat/outpost/`, `apps/web/src/chat/approvals/OutpostStartFacts.tsx` and test, `apps/web/src/conversations/AddToOutpost.tsx`, `OutpostGroup.tsx`, `OutpostRows.tsx`, `outpost-members.ts`, `outpost-rows.css` and tests, `apps/web/src/app/use-outpost-route.ts`, `OutpostIcon`.
- Browser specs: the 13 in the `outposts` group of `spec-map.ts` and `markdown-composer-outpost.spec.ts`; `outposts-kit.ts` after moving `asPairedPhone` to `tests/browser/paired-phone.ts`; the outpost cases in `add-folder.spec.ts`, `agent-tv-list.spec.ts`, `agent-tv-bounds.spec.ts`, `phone-context-bar.spec.ts`; the `outposts` group and prefixes in `spec-map.ts`.
- Guide: `outposts.md`, `outpost-asks.md`, `outpost-stories.md`, `outpost-permissions.md`, `when-to-use-an-outpost.md`, their images, and every link to them.
- `docs/design/mockup/outpost.html`, `outpost-create.html`.

**Change**

- `apps/web/src/app/App.tsx`, `lazy-views.tsx`, `app/live/app-event-keys.ts`, `conversations/ActiveChats.tsx`, `ChatMenu.tsx`, `ChatRowMenu.tsx`, `ConversationList.tsx`, `on-screen.ts`, `sidebar-layout.css`, `chat/TurnSection.tsx`, `SparkActionCard.tsx`, `chat/project/ContextBar.tsx`, `chat/queue/queue-model.ts`, `chat/retry-turn.ts`, `chat/run-refresh.ts`, `crew/AgentTvHost.tsx`, `island/island-rest-line.ts`, `island/use-island-moments.ts`, `phone/PhoneSetup.tsx`, `apps/desktop/src/attention-feed.ts`: remove every outpost branch. Old request turns (run source `chat` with no ask) render "From another chat · not your message".
- Contracts: delete each module that loses its last importer here (`outpost-addressees.ts`, `outpost-handles.ts`, `outpost-address.ts`, `outpost-thread.ts`, `outpost-library.ts` and tests are likely); knip names them.
- Guide pages that mention outposts: `spark-tools.md`, `glossary.md`, `statuses-and-limits.md`, `guardrails.md`, `how-spark-works.md`, `pause-spark.md`, `ship-and-pull-requests.md`, `start-a-chat.md`, `use-your-phone.md`, `companion-quick-chat.md`, `README.md`; the repository `README.md` guide table; `apps/site/index.html` ("start sub-chats in an outpost" becomes "start sub-chats").
- `docs/guide/whats-new.md`: "Outposts are gone. A chat's agent now splits work into sub-chats."

**Tests.** Remove the deleted components' tests; `pnpm check` (knip, guide links) and `pnpm test:browser:changed`.

**Done when** `git grep -il outpost apps/web/src tests/browser docs/guide` returns only product-name lines (`DoneStep.tsx`, `TrustCards.tsx`, `ProviderBlob.tsx`), and `pnpm check` passes.

---

## Slice 8: delete outposts and A2A from the server and contracts

**Goal.** The outpost server code, tools, routes, tables and the A2A dependency are gone.

**Add**

- `apps/server/migrations/0269_drop_outposts.sql` (design section 10): remap run source `outpost` to `chat` or `queue`, recreate `runs_source_check` without it, drop `chat_queue.outpost_post_id`, drop the five tables, expire pending `start_outpost` cards.

**Delete**

- `apps/server/src/outposts/`, `apps/server/src/a2a/`, `apps/server/src/api/outpost-routes.ts`, `apps/server/src/persistence/outpost*.ts`, `apps/server/src/spark-mcp/tools/outpost-*.ts`, `spark-mcp/actions/outpost-actions.ts`, `spark_post_outpost` in `tools/ask-spark-island-tools.ts` and `post_outpost` in `actions/ask-spark-inbox.ts`, `ask-spark-limits.ts`, `ask-spark-perform.ts`.
- Tests: `apps/server/test/a2a-*`, `accepting-peer.ts`, `fake-peer-agent.ts`, `outpost-delivery.db.test.ts`, `post-*.test.ts`, `request-prompt.test.ts`, `story-*.test.ts`, `start-outpost.db.test.ts`, `stack-base.db.test.ts`, `stack-publish.db.test.ts`, `stacked-parent-work.db.test.ts`, `dependency-release.test.ts`, `handshake.test.ts`, `mode-cap.test.ts`, `proposed-mode.test.ts`, `user-asked.test.ts`, `agent-prompt*.test.ts`, `chat-turn-outposts.db.test.ts` (each case that still matters was moved in slices 2 to 4; check before deleting), and the outpost cases listed in design section 12.
- Contracts: the remaining `outpost*.ts` modules, `Run.outpost`, `OUTPOST_DRAFT_ACTIVITY`, `ConversationSummary.outpost`, `QueuedMessage.outpostPostId`, `outpost_changed`, `post_outpost` and `outpostId` in `ask-spark-action.ts`, `start_outpost` in `spark-actions.ts`, the `spark_outpost*` and `spark_post_outpost` entries in `tool-steps.ts`, the "read outposts" wording in `remote.ts`.
- `@a2a-js/sdk` from `apps/server/package.json` and the lockfile.

**Change**

- `spark-mcp/server.ts` (tools, `OUTPOST_INSTRUCTIONS`, `CHAT_TURN_ONLY`), `availability.ts`, `tool.ts`, `deps.ts`, `guide/sections.ts`, `actions/action-policy.ts`, `actions/perform.ts`, `actions/confirm.ts`, `actions/rules-edit-session.ts`.
- `workflow/run-input.ts`, `agent-turn.ts`, `chat-turn.ts`, `chat-turn-prompt.ts`, `command-scope.ts`, `publish-context.ts`, `publish-step-reason.ts`, `queue-drain.ts`, `main.ts`; `orchestration/chat-place.ts` (drop the outpost stack fallback); `compaction/summary.ts`; `crew-flows/chat-started.ts`.
- `persistence/rows.ts`, `runs.ts`, `conversations.ts`, `summary-query.ts`, `conversation-search.ts`, `chat-queue.ts`, `queue-handoff.ts`, `queued-attachments.ts`, `attachments.ts`, `auto-title.ts`, `inactive-chats.ts`.
- `api/app.ts`, `api/main.ts`, `api/routes.ts`, `api/queue-routes.ts`; `remote/route-rules.ts` and `remote/policy.test.ts` (the 19 outpost and A2A lines).
- `tests/browser/database.ts` (table list), `tests/browser/spec-map.ts` (the `apps/server/src/outposts/` and `a2a/` prefixes), `scripts/test-selection.ts` if it names them.
- Keep `FALLBACK_NAME = 'spark_outpost'` in `agents/acp/spark-tools.ts` and `isSparkServer` in `tool-steps.ts`: that is the MCP server's name in stored transcripts, not the feature.

**Tests**

- `pnpm test:db`: `drop-outposts.db.test.ts` (a database with an outpost, members, a story, a queued request and a pending start card migrates: chats, messages, worktrees and pull request watches survive; runs read `chat` or `queue`; the queue has no orphan), `migrate-startup.db.test.ts`, `spark-mcp-availability.db.test.ts`, `spark-tool-budget.test.ts`, `remote-policy.db.test.ts`, `ask-spark-island.db.test.ts`, `spark-pause.db.test.ts`, `archive-inactive.db.test.ts`, `compaction-summary.db.test.ts`, `crew-trigger-chat-started.db.test.ts`, `merged-change-events.db.test.ts`, `attachment-reservations.db.test.ts`, `work-reply-readers.db.test.ts` updated.

**Docs.** `docs/guide/spark-tools.md` (the outpost tool table and `spark_post_outpost` go), `docs/guide/companion-quick-chat.md` (Ask Spark no longer posts to outposts), `whats-new.md`.

**Done when** the server starts on a migrated copy of a real data folder, and `pnpm check` passes with knip clean.

---

## Slice 9: sweep and documents

**Goal.** No dead code and no stale words.

**Do**

- Run the final grep and clear every hit outside old migrations, `releases/`, `apps/desktop/CHANGELOG.md` and `docs/benchmarks/`:
  `git grep -nIiP 'outpost_|spark_outpost_|spark_post_outpost|\ba2a\b|/api/outposts' -- . ':!apps/server/migrations' ':!releases' ':!apps/desktop/CHANGELOG.md' ':!docs/benchmarks'`
  Allowed leftovers: the MCP server name `spark_outpost` in `spark-tools.ts`, `tool-steps.ts` and `scripts/turn-tasks/rows/review-marks.ts`, and database names such as `spark_outpost_test`.
- Run `pnpm knip` and delete what it lists; delete helpers moved in slices 2 to 4 that lost their last caller.
- `AGENTS.md`: replace the outpost paragraph with a sub-chats paragraph (parent and sub-chat, only the agent starts them, one level, `spark_sub_chats` and its card, inheritance and the mode cap, messages between chats and their rules, reports and the read-only wrap-up, stacked rules, paired devices, no caps); replace the A2A paragraph with one sentence that no agent protocol is used between chats today; fix the Ask Spark paragraph (tool list, no outpost posts), the archive paragraph ("an open request in its outpost"), the remote paragraph ("read an outpost…"), the Sparks and workflows paragraph ("an outpost request from another chat", "a sub-chat a lead chat started"), the publish paragraph ("a turn started by an outpost request"), and "Read `docs/architecture/A2A_CHATS.md`" becomes `SUB_CHATS.md`.
- Delete `docs/architecture/A2A_CHATS.md`; mark `SUB_CHATS.md` as built and delete this plan or mark it done; fix the mentions in `PROTOCOL_ALIGNMENT.md`, `PHONE_REMOTE.md`, `REMOTE_CONTROL.md`, `SIMPLE_ORCHESTRATION.md`, `SIMPLE_ORCHESTRATION_TESTS.md`, `CREW_WORKFLOWS_PLAN.md`, `HARNESS_PLAN.md`, `HARNESS_SIMPLE.md`, `LESSONS.md`, `COMPACTION.md`, `ELECTRON_PLAN.md`, `MAC_CONTROL.md`, `NATIVE_TERMINALS.md`, `REPO_AGENT_CONFIG.md`, `SPARK_SLEEP.md`, `SPARK_TOOLS.md`, `docs/product/PLAN.md`.
- `apps/desktop/CHANGELOG.md`: the release note.
- Run `pnpm exec tsx scripts/spark-tool-budget.ts` and record the new sizes in `SUB_CHATS.md`.

**Tests.** `pnpm check`; `pnpm test:changed`, `pnpm test:db:changed`, `pnpm test:browser:changed`; one integration-branch browser run in CI.

**Done when** the grep prints only the allowed leftovers, knip is clean, `pnpm check` passes, and the completion record lists what ran and what is unverified.

---

## Decisions made in planning

1. **The link lives in a `sub_chats` table, not in a `conversations` column.** One row holds the parent, the plan fields and the report, so no chat write path changes and deleting a sub-chat cleans up by cascade. The brief's `conversations.parent_conversation_id` was an example.
2. **No plan table.** A waiting plan is its approval card's payload; a started plan is its rows. The wrap-up's once-only mark is `sub_chats.wrapped_up_at`.
3. **`starts_after` is a list** (the mock shows "Starts after 1, 2, 3"), stored as `uuid[]`. `stackedOn` is one sub-chat and implies waiting for it.
4. **"Done" for releasing a Held sub-chat means "has reported"**, not "pull request merged". A stacked sub-chat must be able to start while its parent sub-chat's pull request is still open; today's rule (released when the awaited request is Answered) is kept.
5. **Steered replies are not read from the stream.** The reply is an explicit `replyTo` call, else the reply of the turn the message started, else the text after the steer's offset when the turn ends, else No reply. Dropping the tail fallback, or not steering asks that want a reply, are both one-line changes.
6. **A message from another chat never stops a turn.** The user's own steer may stop the turn and resend (`interrupt`); a chat's message goes to the queue instead.
7. **One new run source, `chat`**, for every turn started by a task, message, reply, report or wrap-up. Old `outpost` runs are remapped to `chat`, or to `queue` when the user typed the request in the outpost.
8. **The five-word status applies to sub-chats** (tree, flattened rows, Plan, report, `spark_chats`). Other chats keep today's sidebar states; the mock's "Idle" on a plain chat is today's state, not a sixth word.
9. **A failed or stopped turn reads Needs you** with the reason, as outposts grouped Failed under Waiting on you.
10. **Reports start a parent turn only for the task (or a later parent ask).** Turns the user typed in a sub-chat and follow-up rounds update the Plan row silently, so chatting in a sub-chat does not keep waking the parent.
11. **Risks and Blockers come from labelled sections of the sub-chat's reply**; branch and pull request come from Spark's record. Missing sections read "None stated".
12. **Sending between a sub-chat and its parent:** parent → sub-chat follows the mode; in a turn the parent's message started, the sub-chat may message the parent (the same-chat rule); in a turn the user typed in the sub-chat, messaging the parent is "any other chat" and needs the user's words or a card.
13. **"Any chat → any other chat" shows a card in every mode** when the user's message did not ask and name the chat, Bypass permissions and Full access included, as Ask Spark's card answers do.
14. **The plan card edits model and effort only.** Mode is not editable there; the user raises a mode in the sub-chat.
15. **A proposed mode above the parent's refuses the whole call**; an inherited mode is mapped down for another agent.
16. **`spark_sub_chats` needs a project on the parent chat** (as `spark_outpost_start` did), so a chat with no project does not pay for the tool.
17. **The Work panel already has a tab called Plan** (the agent's agreed plan, `TaskDetails.tsx`). The sub-chats tab takes the name **Plan**; the old one becomes **Agreed plan**. Owner should confirm the rename.
18. **The user's Send now on a queued message from another chat is refused**, as it is for Ask Spark's messages; Spark steers those itself at delivery.
19. **A parent is not auto-archived** while a sub-chat is Working or Held (replaces "an open request in its outpost").
20. **Old outpost request turns stay in transcripts** and render "From another chat · not your message"; outpost threads, notes, pins, instructions and drafts are dropped with the tables.
21. **Deletion order is web, then server**, so typecheck holds at each step; contract modules go with their last importer.
22. **A2A is removed, not kept dormant** (`@a2a-js/sdk` leaves `package.json`), per AGENTS.md's "do not wrap every internal function in a protocol without a current need".

## What the owner's decisions make hard

- **"No chains" also binds the parent.** A report starts a turn in the parent, and that turn was started by another chat's message, so by the rule it may answer the reporting sub-chat but may not message a sibling sub-chat or start more. The parent relays between sub-chats only on a turn the user typed. If the parent should coordinate on its own, exempt "a parent messaging its own sub-chats" from the no-chains rule; that is one condition in `sub-chats/asks.ts`.
- **Steering text the user did not type** is new: today `sendNow` refuses to steer anything but the user's own message. The steered text sits inside a turn the user started, so the backend's "the user's message asks for it" checks still read the turn's first message and are safe, but the agent itself reads the steer in the same session as the user's instructions. The wrapper labels it and it sets the send flag; the publish prompt's "later steering in this session" wording must say "the user's later steering".
- **A prompt reply from a busy chat depends on the agent calling `replyTo`.** Without it the reply arrives at the end of the turn (tail fallback) or not at all.
- **Tool budget.** Every chat now carries `spark_send_to_chat`, and chats with a project carry `spark_sub_chats` with a nested input. `spark_outpost_draft` leaves, but the plain-chat cap in `spark-tool-budget.test.ts` needs checking in slices 2 and 3.
- **The Plan tab name clashes** with the existing agreed-plan tab (decision 17), and the Work panel's tabs are built around a task; a parent that only splits work has no task of its own, so the panel must show the tab without one.
- **knip per slice.** Moving stack and mode-cap code while outposts still run means the old modules import the moved ones for a few slices; the fallback in `chat-place.ts` and `publish-context.ts` must go in slice 8 or it is dead code.
