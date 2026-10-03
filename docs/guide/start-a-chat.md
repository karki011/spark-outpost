---
title: Start a chat and link a project
section: Chats
type: how-to
order: 210
summary: Start a chat, link the folder the agent may work in, and add files or commands to your message.
---

You'll start a chat and point it at your code. About 1 minute.

## Start a chat

1. Select **Chats** in the rail.
2. Select **New chat** at the top of the chat list, or press **⌘⇧O**.
3. Type your message and press **Enter**.

![A new chat with the message box and the context bar above it](images/chats-and-modes-new-chat-light.png)

You can also type in **Start a new chat** on **Home**, or select **+** next to a project's name in the chat list.

## Link a project

Without a project the agent can answer but can't read or change files. The context bar says **Not linked, so the agent can't read files**.

1. Above the message box, select **Choose project**.
2. Pick a folder under **Recent**, or select **Choose a folder…** and then **Use this folder**.
3. To add a second repo, open the same menu and select **Add another repo…**. The first repo is **Primary**.

![The context bar with a linked project, its branch and the Spark autonomy chip](images/chats-and-modes-project-light.png)

To unlink, open the menu and select **No project (chat only)**.

## Write a message

| Type or select                    | To                                                                       |
| --------------------------------- | ------------------------------------------------------------------------ |
| **Enter** / **Shift+Enter**       | Send / add a new line                                                    |
| **@**                             | Add a file from the project                                              |
| **/**                             | Run a command: `/plan`, `/review`, `/model`, `/effort`, `/mcp`, `/fresh` |
| **+** (**Add files and context**) | **Upload a file**, **Add a screenshot** or **Add from repo**             |

You can also paste or drag files into the box. `/fresh` starts a new agent session for this chat.

> **Tip:** To talk to a named teammate instead, select **Talk to…** before your first message. See [Make a Spark](sparks.md).

**Next:** [Change the agent's mode](agent-mode.md)
