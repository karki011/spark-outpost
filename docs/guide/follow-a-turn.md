---
title: Follow, stop and queue messages
section: Chats
type: how-to
order: 216
summary: See what the agent is doing, stop it, queue more messages while it works, and delete a running chat.
---

You'll follow, stop and queue a turn. About 2 minutes.

## See what's happening

1. Read the reply's header, such as **Reading api.ts · 3 steps**.
2. Select the step count, then **Thinking** to read it.
3. **Show work panel** has the plan, files and cost; **Agent TV** is in the **…** menu.
4. Sub-agents share one line; **View** shows a card each.

When the agent needs you, select **Waiting for you** or press **⌘⇧Y**.

Failed command output stays open in the reply. **Open in terminal** shows it in a [dock tab](terminals.md#watch-an-agents-command).

## Stop a turn

1. Select **Stop**. Its sub-agents and background work stop too.

## Background work

While Claude's background agents run, the chat shows **Waiting on 1 background agent**, then **Writing up results**. **Enter** reaches it; **Stop background tasks** ends them.

The agent stays running between messages, up to 30 idle minutes. A turn it starts itself shows **Continued on its own**.

## Queue messages

1. While a turn runs, type a message. **Enter** queues it.
2. **⌘Enter** sends it now.
3. While the agent waits on sub-agents, **Enter** sends now.
4. Use **Edit**, **Move up**, **Move down**, **Remove** or **Send now** on a queued message.

| When                           | Spark                                |
| ------------------------------ | ------------------------------------ |
| The turn finishes              | Sends queued messages in order.      |
| You send one now               | Shows its status.                    |
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
