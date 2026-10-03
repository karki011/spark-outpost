---
title: Follow, stop or delete a chat
section: Chats
type: how-to
order: 218
summary: See what the agent is doing right now, stop it, read its steps, and delete a chat even while it works.
---

You'll follow a running turn and stop it when you need to. About 2 minutes.

## See what's happening

1. Read the line above the message box. It says what the agent is doing, such as **Running · pnpm test** or **Editing · table.tsx**.
2. Read the reply's header, such as **Claude working · 3 steps**. Select the step count to show or hide the steps.
3. For the plan, crew, files and cost, select **Show work panel** in the chat header.

Steps use plain words, such as **Read `table.tsx`**, never raw tool names. Secrets in commands show as •••.

When the agent needs you, the line says **Waiting for you** and what for. Select it, or press **⌘⇧Y**, to jump to the card.

## Stop a turn

Select **Stop**. It replaces the send button while a turn runs. The turn says "Stopped before finishing."

## Delete a chat

1. Open the chat's **…** menu and select **Delete**, then **Confirm delete**.
2. To take it back, select **Undo** on the message that appears.

A running chat can be deleted too. Spark stops its work first, and the message says **Stopping and deleting**.

## Under a reply

| You see                    | Meaning                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| A chip such as **Bug fix** | The kind of request Spark read. Hover it for details.            |
| Tokens, cost and time      | What the reply used. Hover the tokens for the model and effort.  |
| **Save as agreed plan**    | The reply reads as a plan. Select it to make it the chat's plan. |
| **Task 6/6 · Done**        | The task card: plan progress, checks, pull request.              |

## After a turn

- Select text in a reply to **Add to chat**, **Ask about this**, **Comment** or **Copy**.
- Rate it with **Good result** or **Bad result**. Ratings stay on this computer.
- Type `/fresh`, or select **Start fresh** in the **…** menu, to restart the agent without the old context.

**Next:** [Queue messages while the agent works](queue-messages.md)
