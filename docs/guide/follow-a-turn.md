---
title: Follow, stop and queue messages
section: Chats
type: how-to
order: 216
summary: Follow work, stop it, queue files and messages, or delete a running chat.
---

About 2 minutes.

## See what's happening

1. Summaries separate commands **passed** from tools **done**.
2. Code Mode labels discovery and combined reads; command failures expand.
3. The to-do ticks off, then folds.
4. Sidebar blobs show the **Agent TV** team. Select to open.
5. **View agents** opens **Work**.
6. **Message** opens that chat’s composer; Outposts show handles.
7. **Ask lead to redirect** drafts in the worker’s owning chat.

**⌘⇧Y** jumps to the waiting card.

**Open in terminal** shows failed output in a [dock tab](terminals.md#watch-an-agents-command).

## Stop a turn

1. **Stop** or **Esc** also stops sub-agents and background work.

## Background work

During **Waiting on 1 background agent** or Claude’s **Sleeping until 10:48**, **Stop background tasks** or **Stop waiting** ends it.

Waits last 30 idle minutes. Resumed turns show **Continued on its own**.

## Queue messages

Send files without text. Queues survive restarts; drafts do not.

1. While a turn runs, **Enter** queues a message.
2. **⌘Enter** sends it into the turn: **Sent**, then **Claude took this in**.
3. While the agent only waits on background work, **Enter** sends now; queued messages follow.
4. Queued messages have **Edit**, **Move up**, **Move down**, **Remove** and **Send now**; **Retry** messages are read-only.

| When                      | Spark                                 |
| ------------------------- | ------------------------------------- |
| The turn finishes         | Sends queued messages in order.       |
| You stop it, or it fails  | Pauses the queue until **Send now**.  |
| You stop before it's read | **Send as next message** or **Edit**. |
| The agent can't take it   | Queues a sent-now message first.      |

## Delete a running chat

1. Select **… → Delete → Confirm delete**.
2. **Undo** restores it.

## After a turn

Finished steps fold under **Worked for …**; select to open.

| Under a reply                                  | Use it to                                                   |
| ---------------------------------------------- | ----------------------------------------------------------- |
| **Good result** / **Bad result**               | Rate the PR turn.                                           |
| Selected text                                  | **Add to chat**, **Ask about this**, **Comment**, **Copy**. |
| `/fresh`, or **Start fresh** in the **…** menu | Restart without the old context.                            |
| Ticks left of the thread                       | Jump to a message.                                          |

**Next:** [Answer an approval card](answer-approvals.md)
