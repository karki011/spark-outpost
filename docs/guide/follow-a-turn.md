---
title: Follow, stop and queue messages
section: Chats
type: how-to
order: 216
summary: Follow work, stop it, queue files and messages, or delete a chat that is running.
---

About 2 minutes.

## See what's happening

1. The working line shows step, time or **No output for 2m**; **Thinking** expands.
2. Answered cards and flags stay; waiting cards sit last.
3. Summaries: commands **passed** or **blocked**, tools **done**.
4. Browser, web and Mac steps show.
5. Code Mode labels discovery and combining; failures expand.
6. Edits show **+N −M**; open as diffs.
7. Done to-dos fold.
8. Sidebar blobs show **Agent TV**.
9. **View agents** opens **Work**; over four become faces.
10. **Message** opens that chat’s composer; **Ask lead to redirect** drafts in that chat.

**Open in terminal** shows failures in a [dock tab](terminals.md#watch-an-agents-command).

## Stop a turn

**Stop** or **Esc** stops sub-agents and background work; unfinished steps show **Stopped**.

## Background work

**Stop background tasks** or **Stop waiting** ends **Waiting on 1 background agent** or Claude’s **Sleeping until 10:48**.

Agent waits stop at 30 minutes (**Continued on its own**).

## Queue messages

Queues survive restarts; drafts stay in this browser.

1. **Enter** mid-turn queues a message.
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

Select **… → Delete → Confirm delete**; **Undo** restores that chat.

## After a turn

Steps fold under **Worked for …**; steered replies don't.

| Under a reply                    | Use it to                                       |
| -------------------------------- | ----------------------------------------------- |
| **Good result** / **Bad result** | Rate the PR turn.                               |
| Selected text                    | **Add to chat**, **Comment**, **Copy**.         |
| Choices                          | Only fill the message box, or **Show as list**. |
| HTML folds                       | **Enter** toggles.                              |
| `/fresh` or **… → Start fresh**  | Drop old context.                               |
| Ticks left of the thread         | Jump to messages.                               |

**Next:** [Answer an approval card](answer-approvals.md)
