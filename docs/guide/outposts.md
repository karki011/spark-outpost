---
title: Work across chats in an outpost
section: Chats
type: how-to
order: 232
summary: Put several chats in one outpost, ask each for work with @ and its handle, and read every answer in one thread.
---

You'll ask several chats for work from one thread. About 3 minutes. Not sure you need one? See [When to use an outpost](when-to-use-an-outpost.md).

## Create an outpost

1. In the sidebar, select **New outpost** (**+**) beside **Outposts** and enter a **Name**.
2. Add each **Existing chat**, or a **New chat** with a **Project**, **Agent** and **Permissions**. Check its handle, such as `api`.
3. Optionally select **Add a first message** and attach files. It is sent as your first request when the outpost starts.
4. Select **Continue**, check the review, then **Start outpost**. The thread introduces each chat.

Or select **Add to outpost** in a chat's row menu. A chat joins one outpost; Terminal sessions can't.

## Send a request

1. Type `@api` and your request, then select **Send request**.
2. The chat's final reply lands under it with its [state](statuses-and-limits.md#outpost-requests), branch, files and pull request.
3. **Needs you**: the chat has a question or an approval card. Select **Answer**, then **Send answer**; both stay under the request. For a card, **Open in chat**.

Without a handle, **Post note** starts no work.

| Select                 | To                                                        |
| ---------------------- | --------------------------------------------------------- |
| **Cancel**             | Stop a request.                                           |
| **Pause** / **Resume** | Hold requests that haven't started. Running turns finish. |
| **Edit outpost**       | Rename, change chats and handles, or delete. Chats stay.  |

## In the chat

| You see                          | Means                                                             |
| -------------------------------- | ----------------------------------------------------------------- |
| A chip with the outpost's name   | Opens it.                                                         |
| **From you**, heading a turn     | A request started this turn, under this chat's mode and autonomy. |
| **Outpost request** in the queue | The chat is busy. You can remove it, not edit it.                 |

A request you type counts as your message: "open a PR" [publishes](ship-and-pull-requests.md#when-the-agent-publishes), and `/plan` runs as a command. Why: [What an outpost request may do](outpost-permissions.md).

Agents can't ask each other yet. On a [paired phone](use-your-phone.md) you can read, post, cancel, pause and rename; the rest stays on the Mac.

**Next:** [Choose where a chat works](where-spark-works.md)
