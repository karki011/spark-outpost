---
title: Follow, stop and queue messages
section: Chats
type: how-to
order: 216
summary: See what the agent is doing, stop it, queue more messages while it works, and delete a chat even while it runs.
---

You'll follow a running turn, stop it, and line up more messages. About 2 minutes.

## See what's happening

1. Read the line above the message box, such as **Running · pnpm test**.
2. Select the step count in the reply's header, such as **3 steps**, to show the steps.
3. Select **Show work panel** in the chat header for the plan, crew, files and cost.

When the agent needs you, the line says **Waiting for you**. Select it, or press **⌘⇧Y**, to jump to the card.

## Stop a turn

1. Select **Stop**. It replaces the send button while a turn runs.

## Queue messages

1. While a turn runs, type a message and press **Enter**.
2. Use **Edit**, **Move up**, **Move down** or **Remove** on a queued message.
3. Select **Send now** to send one before the turn ends.

| When                           | Spark                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------- |
| The turn finishes              | Sends queued messages one at a time, in order.                                |
| You select **Send now**        | Hands it to the agent at its next step, or stops the turn and sends it first. |
| You stop the turn, or it fails | Pauses the queue until you select **Send now**.                               |
| You reload or restart          | Keeps the queue.                                                              |

Only text can be queued.

## Delete a chat

1. Open the chat's **…** menu and select **Delete**, then **Confirm delete**.
2. To take it back, select **Undo**.

A running chat can be deleted too: Spark stops its work first.

## After a turn

| Under a reply                                  | Use it to                                                   |
| ---------------------------------------------- | ----------------------------------------------------------- |
| Tokens, cost and time                          | See what the reply used.                                    |
| **Good result** / **Bad result**               | Rate the reply. Ratings stay on this computer.              |
| **Save as agreed plan**                        | Make the reply the chat's plan.                             |
| Selected text                                  | **Add to chat**, **Ask about this**, **Comment**, **Copy**. |
| `/fresh`, or **Start fresh** in the **…** menu | Restart the agent without the old context.                  |

**Next:** [Answer an approval card](answer-approvals.md)
