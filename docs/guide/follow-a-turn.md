---
title: Follow, stop and queue messages
section: Chats
type: how-to
order: 216
summary: See what the agent is doing, stop it, queue more messages while it works, and delete a running chat.
---

You'll follow, stop and queue a turn. About 2 minutes.

## See what's happening

1. Each tool call is a row; reads fold into **Explored 2 files**.
2. **Thought for 4s** opens the thinking; a failed command opens itself.
3. The to-do ticks off, then folds.
4. Hover a reply for **Copy**, ratings and cost. **Agent TV** is under **…**.
5. Sub-agents share one line; **View** shows their cards.

A waiting card sits at the turn's end; **⌘⇧Y** jumps there.

**Open in terminal** shows failed output in a [dock tab](terminals.md#watch-an-agents-command).

## Stop a turn

1. Select **Stop** or press **Esc**; sub-agents and background work stop too.

## Background work

While background agents run, the chat shows **Waiting on 1 background agent**. A sleeping Claude agent shows **Sleeping until 10:48**, then wakes in that turn. **Stop background tasks** or **Stop waiting** ends the wait.

The agent stays running up to 30 idle minutes. A turn it starts itself shows **Continued on its own**; after Quit, **Stopped by Quit**.

## Queue messages

Other chats never wait; each starts when you send.

1. While a turn runs, **Enter** queues a message.
2. **⌘Enter** sends it now.
3. While the agent waits, **Enter** sends now.
4. Use **Edit**, **Move up**, **Move down**, **Remove** or **Send now** on a queued message.

| When                           | Spark                                |
| ------------------------------ | ------------------------------------ |
| The turn finishes              | Sends queued messages in order.      |
| You stop the turn, or it fails | Pauses the queue until **Send now**. |
| You reload or restart          | Keeps the queue.                     |

## Delete a running chat

1. In the chat's **…** menu, select **Delete**, then **Confirm delete**.
2. **Undo** restores it.

## After a turn

| Under a reply                                  | Use it to                                                   |
| ---------------------------------------------- | ----------------------------------------------------------- |
| **Good result** / **Bad result**               | Rate the reply locally.                                     |
| Selected text                                  | **Add to chat**, **Ask about this**, **Comment**, **Copy**. |
| `/fresh`, or **Start fresh** in the **…** menu | Restart without the old context.                            |
| Ticks left of the thread                       | Jump to a message.                                          |

**Next:** [Answer an approval card](answer-approvals.md)
