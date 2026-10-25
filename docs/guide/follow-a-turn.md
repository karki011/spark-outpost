---
title: Follow, stop and queue messages
section: Chats
type: how-to
order: 216
summary: See what the agent is doing, stop it, queue more messages while it works, and delete a running chat.
---

Follow a turn. About 2 minutes.

## See what's happening

1. Steps fold into summaries.
2. Open commands for details; failures expand.
3. The to-do ticks off, then folds.
4. Open **Agent TV** under **…**.
5. Worker blobs show roles and status; **View agents** opens cards in **Work**. Ended turns never show active workers.
6. **Message lead** or a member opens its composer; you send.
7. **Ask lead to redirect** drafts a lead request, not a sub-agent message.

**⌘⇧Y** jumps to the waiting card.

**Open in terminal** shows failed output in a [dock tab](terminals.md#watch-an-agents-command).

## Stop a turn

1. Select **Stop** or press **Esc**; sub-agents and background work stop.

## Background work

During **Waiting on 1 background agent** or Claude’s **Sleeping until 10:48**, **Stop background tasks** or **Stop waiting** ends it.

It stays up to 30 idle minutes; a turn it starts shows **Continued on its own**, and after Quit **Stopped by Quit**.

## Queue messages

Draft text survives chat switches, not app reloads. Other chats never wait.

1. While a turn runs, **Enter** queues a message.
2. **⌘Enter** sends it into the turn: **Sent**, then **Claude took this in**.
3. While the agent waits, **Enter** sends now.
4. Use **Edit**, **Move up**, **Move down**, **Remove** or **Send now** on a queued message.

| When                      | Spark                                 |
| ------------------------- | ------------------------------------- |
| The turn finishes         | Sends queued messages in order.       |
| You stop it, or it fails  | Pauses the queue until **Send now**.  |
| You reload or restart     | Keeps the queue.                      |
| You stop before it's read | **Send as next message** or **Edit**. |

## Delete a running chat

1. Select **… → Delete → Confirm delete**.
2. **Undo** restores it.

## After a turn

| Under a reply                                  | Use it to                                                   |
| ---------------------------------------------- | ----------------------------------------------------------- |
| **Good result** / **Bad result**               | Rate the PR turn.                                           |
| Selected text                                  | **Add to chat**, **Ask about this**, **Comment**, **Copy**. |
| `/fresh`, or **Start fresh** in the **…** menu | Restart without the old context.                            |
| Ticks left of the thread                       | Jump to a message.                                          |

**Next:** [Answer an approval card](answer-approvals.md)
