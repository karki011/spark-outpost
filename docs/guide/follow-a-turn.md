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
4. Code Mode labels discovery and reads; failures expand.
5. The to-do folds when done.
6. Sidebar blobs show the **Agent TV** team.
7. **View agents** opens **Work**; done workers fold.
8. **Message** opens that chat’s composer; Outposts show handles.
9. **Ask lead to redirect** drafts in that chat.

**Open in terminal** shows failed output in a [dock tab](terminals.md#watch-an-agents-command).

## Stop a turn

1. **Stop** or **Esc** also stops sub-agents and background work.

## Background work

During **Waiting on 1 background agent** or Claude’s **Sleeping until 10:48**, **Stop background tasks** or **Stop waiting** ends it.

Waits last 30 idle minutes; resumed turns show **Continued on its own**.

## Queue messages

Send files without text. Queues survive restarts; drafts don't.

1. While a turn runs, **Enter** queues a message.
2. **⌘Enter** sends it into the turn: **Sent**, then **Claude took this in**.
3. While the agent only waits, **Enter** sends now; the queue follows.
4. Queued: **Edit**, **Move up**, **Move down**, **Remove**, **Send now**; **Retry** ones are read-only.

| When                      | Spark                                 |
| ------------------------- | ------------------------------------- |
| The turn finishes         | Sends the queue in order.             |
| Stopped or failed         | Queue pauses until **Send now**.      |
| You stop before it's read | **Send as next message** or **Edit**. |
| Agent can't take it       | Queues it first.                      |

## Delete a running chat

1. Select **… → Delete → Confirm delete**.
2. **Undo** restores it.

## After a turn

Steps fold under **Worked for …**; steered replies don't.

| Under a reply                    | Use it to                                                   |
| -------------------------------- | ----------------------------------------------------------- |
| **Good result** / **Bad result** | Rate the PR turn.                                           |
| Selected text                    | **Add to chat**, **Ask about this**, **Comment**, **Copy**. |
| `/fresh` or **… → Start fresh**  | Restart without old context.                                |
| Ticks left of the thread         | Jump to a message.                                          |

**Next:** [Answer an approval card](answer-approvals.md)
