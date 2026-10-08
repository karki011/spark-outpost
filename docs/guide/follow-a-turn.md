---
title: Follow, stop and queue messages
section: Chats
type: how-to
order: 216
summary: See what the agent is doing, stop it, queue more messages while it works, and delete a chat even while it runs.
---

You'll follow a running turn, stop it and queue more messages. About 2 minutes.

## See what's happening

1. Read the reply's header, such as **Reading api.ts · 3 steps**, or the line above the message box.
2. Select the step count, then **Thinking** to read it.
3. Select **Show work panel** in the chat header for the plan, crew, files and cost.

When the agent needs you, the line says **Waiting for you**. Select it or press **⌘⇧Y**.

Commands show output in a terminal in the reply. Passing ones fold to a line; failed ones stay open. Codex output is live; Claude's appears when the command ends.

## Stop a turn

1. Select **Stop**, which replaces the send button.

## Queue messages

1. While a turn runs, type a message. **Enter** queues it.
2. **⌘Enter** sends it now.
3. Use **Edit**, **Move up**, **Move down**, **Remove** or **Send now** on a queued message.

| When                           | Spark                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| The turn finishes              | Sends queued messages in order.                                                     |
| You send one now               | Shows it in the chat with its status: read next step, or sent after the turn stops. |
| You stop the turn, or it fails | Pauses the queue until you select **Send now**.                                     |
| You reload or restart          | Keeps the queue.                                                                    |

Only text can be queued. Swap the keys in [Settings](settings.md#spark).

## Delete a running chat

1. Open the chat's **…** menu and select **Delete**, then **Confirm delete**. Running work stops.
2. To restore it, select **Undo**.

## After a turn

| Under a reply                                  | Use it to                                                   |
| ---------------------------------------------- | ----------------------------------------------------------- |
| **Good result** / **Bad result**               | Rate the reply. Ratings stay on this computer.              |
| Selected text                                  | **Add to chat**, **Ask about this**, **Comment**, **Copy**. |
| `/fresh`, or **Start fresh** in the **…** menu | Restart the agent without the old context.                  |
| Ticks left of the thread                       | Jump to a message.                                          |

**Next:** [Answer an approval card](answer-approvals.md)
