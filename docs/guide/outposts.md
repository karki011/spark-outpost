---
title: Work across chats in an outpost
section: Chats
type: how-to
order: 232
summary: Put several chats in one outpost, ask each for work with @ and its handle, and read every answer in one thread.
---

Ask several chats from one thread. About 3 minutes. See also [When to use an outpost](when-to-use-an-outpost.md).

## Create an outpost

1. Select **New outpost** (**+**) beside **Outposts** and enter a **Name**.
2. Add each **Existing chat**, or a **New chat** with a **Project**, **Agent** and **Permissions**. Check its handle, like `api`.
3. Optionally **Add a first message** and files: your first request.
4. Select **Continue**, check the review, then **Start outpost**. The thread introduces each chat.

Or select **Add to outpost** in a chat's row menu. A chat joins one outpost and is listed under it; Terminal sessions can't.

## Send a request

1. Type a request with `@api` anywhere, several handles or `@all`. **Asks:** lists them; remove one to only mention it. Then **Send request**.
2. Each final reply lands under it with [state](statuses-and-limits.md#outpost-requests), branch, files, **Pushed**, pull request.
3. **Needs you**: the chat has a question or an approval card. Select **Answer**, then **Send answer**; both stay there. For a card, **Open in chat**.

No handle: **Post note** starts no work.

| Select                 | To                                                        |
| ---------------------- | --------------------------------------------------------- |
| **Cancel**             | Stop a request.                                           |
| **Pause** / **Resume** | Hold requests that haven't started. Running turns finish. |
| **Edit outpost**       | Rename, change chats and handles, or delete. Chats stay.  |

## In the chat

| You see                          | Means                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| A chip with the outpost's name   | Opens it.                                                                            |
| **From you**, heading a turn     | A request started this turn, under this chat's mode and autonomy.                    |
| **Outpost request** in the queue | The chat is busy, or its last turn failed or stopped (**Send now**). Removable only. |

A request you type counts as your message: "open a PR" [publishes](ship-and-pull-requests.md#when-the-agent-publishes), and `@api /plan` is a command, or text with several handles. Why: [What an outpost request may do](outpost-permissions.md).

Agents can [ask each other](outpost-asks.md) and [propose sub-tasks](outpost-stories.md). A [paired device](use-your-phone.md) can read, post, cancel, pause and rename; the rest stays on the Mac.

**Next:** [Choose where a chat works](where-spark-works.md)
