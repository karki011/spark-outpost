---
title: Queue messages while the agent works
section: Chats
type: how-to
order: 220
summary: Send more messages while a turn runs, reorder or edit them, and send one right away.
---

You'll line up messages while the agent is busy. About 1 minute.

1. While a turn runs, type your message and press **Enter**, or select **Queue message** next to **Stop**.
2. The queue appears above the message box with a count, such as **2 queued**.
3. To change it, use the buttons on each message: **Edit**, **Move up**, **Move down** and **Remove**.
4. To send one before the turn ends, select **Send now**.

## What happens to queued messages

| When                          | Spark                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------- |
| The turn finishes             | Sends the queued messages one at a time, in order.                            |
| You select **Send now**       | Hands it to the agent at its next step, or stops the turn and sends it first. |
| You stop the turn or it fails | Pauses the queue until you select **Send now**.                               |
| You reload or restart         | Keeps the queue. It's saved with the chat.                                    |

Only text can be queued. Files wait until the turn ends.

> **Tip:** To tell one crew member something without queueing, message it directly. See [Watch and message the crew](agent-tv.md#message-a-crew-member).

**Next:** [Answer an approval card](answer-approvals.md)
