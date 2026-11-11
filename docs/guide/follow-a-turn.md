---
title: Follow, stop and queue messages
section: Chats
type: how-to
order: 216
summary: Follow work, stop it, queue files and messages, or delete a running chat.
---

About 2 minutes.

## See what's happening

1. The working line shows the step and time.
2. Answered cards and flags stay; waiting cards sit last.
3. Summaries separate commands **passed** from tools **done**.
4. Browser, web, page and Mac steps get rows.
5. Code Mode labels discovery and reads; failures expand.
6. Edits show **+N −M** and open to a diff.
7. A done to-do folds.
8. Sidebar blobs show the **Agent TV** team.
9. **View agents** opens **Work**; over four workers become clickable faces.
10. **Message** opens that chat’s composer; **Ask lead to redirect** drafts there.

**Open in terminal** shows failures in a [dock tab](terminals.md#watch-an-agents-command).

## Stop a turn

1. **Stop** or **Esc** stops sub-agents and background work.

## Background work

**Stop background tasks** or **Stop waiting** ends **Waiting on 1 background agent** or Claude’s **Sleeping until 10:48**.

Waits last 30 minutes; resumed turns show **Continued on its own**.

## Queue messages

Queues survive restarts; unsent text stays in this browser.

1. During a turn, **Enter** queues a message.
2. **⌘Enter** sends it into the turn: **Sent**, then **Claude took this in**.
3. While the agent waits, **Enter** sends now; the queue follows.
4. Queued: **Edit**, **Move up**, **Move down**, **Remove**, **Send now**; **Retry** ones are read-only.

| When                      | Spark                                 |
| ------------------------- | ------------------------------------- |
| The turn finishes         | Sends the queue in order.             |
| Stopped or failed         | Paused until **Send now**.            |
| You stop before it's read | **Send as next message** or **Edit**. |
| Agent can't take it       | Queued first.                         |

## Delete a running chat

1. Select **… → Delete → Confirm delete**.
2. **Undo** restores it.

## After a turn

Steps fold under **Worked for …**; steered replies don't.

| Under a reply                    | Use it to                                                   |
| -------------------------------- | ----------------------------------------------------------- |
| **Good result** / **Bad result** | Rate the PR turn.                                           |
| Selected text                    | **Add to chat**, **Ask about this**, **Comment**, **Copy**. |
| Choices                          | Only fill the message box, or **Show as list**.             |
| `/fresh` or **… → Start fresh**  | Drop old context.                                           |
| Ticks left of the thread         | Jump to messages.                                           |

**Next:** [Answer an approval card](answer-approvals.md)
