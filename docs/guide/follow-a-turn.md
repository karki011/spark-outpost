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

When the agent needs you, the line says **Waiting for you**. Select it or press **⌘⇧Y**.

Command output shows in the reply; failed ones stay open. **Open in terminal** shows it in a [dock tab](terminals.md#watch-an-agents-command).

## Stop a turn

1. Select **Stop**, which replaces the send button. Its sub-agents stop too.

## Background work

A Claude agent may reply while background agents still run. The chat shows **Waiting on 1 background agent**, not Done, then continues. **Enter** reaches the agent; **Stop background tasks** ends the work.

## Queue messages

1. While a turn runs, type a message. **Enter** queues it.
2. **⌘Enter** sends it now.
3. While the agent waits on sub-agents, **Enter** sends now.
4. Use **Edit**, **Move up**, **Move down**, **Remove** or **Send now** on a queued message.

| When                           | Spark                                           |
| ------------------------------ | ----------------------------------------------- |
| The turn finishes              | Sends queued messages in order.                 |
| You send one now               | Shows its status.                               |
| You stop the turn, or it fails | Pauses the queue until you select **Send now**. |
| You reload or restart          | Keeps the queue.                                |

Only text can be queued.

## Delete a running chat

1. In the chat's **…** menu, select **Delete**, then **Confirm delete**. Running work stops.
2. To restore it, select **Undo**.

## After a turn

| Under a reply                                  | Use it to                                                   |
| ---------------------------------------------- | ----------------------------------------------------------- |
| **Good result** / **Bad result**               | Rate the reply. Ratings stay on this computer.              |
| Selected text                                  | **Add to chat**, **Ask about this**, **Comment**, **Copy**. |
| `/fresh`, or **Start fresh** in the **…** menu | Restart the agent without the old context.                  |
| Ticks left of the thread                       | Jump to a message.                                          |

**Next:** [Answer an approval card](answer-approvals.md)
