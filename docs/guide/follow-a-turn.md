---
title: Follow, stop and queue messages
section: Chats
type: how-to
order: 216
summary: Follow work, stop it, queue files and messages, or delete a running chat.
---

About 2 minutes.

## See what's happening

1. The working line names the current step and its time.
2. Answered cards and flags stay in place; waiting cards sit last.
3. Summaries separate commands **passed** from tools **done**.
4. Code Mode labels discovery and combined reads; failures expand.
5. The to-do ticks off, then folds.
6. Sidebar blobs show the **Agent TV** team.
7. **View agents** opens **Work**; done workers fold.
8. **Message** opens that chat’s composer; Outposts show handles.
9. **Ask lead to redirect** drafts in the worker’s chat.

**⌘⇧Y** jumps to the waiting card.

**Open in terminal** shows failed output in a [dock tab](terminals.md#watch-an-agents-command).

## Stop a turn

1. **Stop** or **Esc** also stops sub-agents and background work.

## Background work

During **Waiting on 1 background agent** or Claude’s **Sleeping until 10:48**, **Stop background tasks** or **Stop waiting** ends it.

Waits last 30 idle minutes; resumed turns show **Continued on its own**.

## Queue messages

Send files without text.

1. While a turn runs, **Enter** queues a message.
2. **⌘Enter** sends it into the turn: **Sent**, then **Claude took this in**.
3. While the agent waits, **Enter** sends now.
4. Queued messages offer **Edit**, **Move up**, **Move down**, **Remove**, **Send now**.

| When                      | Spark                                 |
| ------------------------- | ------------------------------------- |
| The turn finishes         | Sends the queue in order.             |
| Stopped or failed         | Queue pauses until **Send now**.      |
| Reload or restart         | Queue kept.                           |
| You stop before it's read | **Send as next message** or **Edit**. |

## Delete a running chat

1. Select **… → Delete → Confirm delete**.
2. **Undo** restores it.

## After a turn

Finished steps fold under **Worked for …**; select to open.

| Under a reply                    | Use it to                                                   |
| -------------------------------- | ----------------------------------------------------------- |
| **Good result** / **Bad result** | Rate the PR turn.                                           |
| Selected text                    | **Add to chat**, **Ask about this**, **Comment**, **Copy**. |
| `/fresh` or **… → Start fresh**  | Restart without old context.                                |
| Ticks left of the thread         | Jump to a message.                                          |

**Next:** [Answer an approval card](answer-approvals.md)
