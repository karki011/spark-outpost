---
title: Start a chat and link a project
section: Chats
type: how-to
order: 210
summary: Start a chat, link the folder the agent may work in, and add files or commands to your message.
---

You'll start a chat linked to your code. About 1 minute.

## Start a chat

1. Select **Chats** in the rail, then **New chat** (**⌘⇧O**).
2. Leave **Chat** selected, type your message and press **Enter**.

![A new chat with the message box and the context bar above it](images/chats-and-modes-new-chat-light.png)

Or type in **Start a new chat** on **Home**.

Choose **Terminal** for native Claude Code or Codex: [Open a terminal](terminals.md).

## Link a project

1. Above the message box, select **Choose project**.
2. Pick a folder under **Recent**, or select **Choose a folder…**, then **Use this folder**.
3. For another repo, select **Add another repo…**.

To clone, select **Projects → + → Clone a repository**.

![The context bar with a linked project, its branch and the Spark autonomy chip](images/chats-and-modes-project-light.png)

To unlink, select **No project folder** in the menu.

## Write a message

| Type or select                    | To                                                                       |
| --------------------------------- | ------------------------------------------------------------------------ |
| **Enter** / **Shift+Enter**       | Send / add a new line                                                    |
| **@**                             | Add a file from the project                                              |
| **/**                             | Run a command: `/plan`, `/review`, `/model`, `/effort`, `/mcp`, `/fresh` |
| **+** (**Add files and context**) | **Upload a file**, **Add a screenshot**, **Add from repo**, another chat |

Or paste or drag files into the box.

## Share a chat with another chat

Copy its link from **Chat actions → Copy chat link**, then paste into another chat. The agent can [read it](spark-tools.md), never change it.

For several chats in one thread, use an [outpost](outposts.md).

> **Tip:** Select **Talk to…** or type `@` to work with a [Spark](sparks.md).

## Jump between sessions

1. Press **⌘⇧K**, or select **Sessions** above the chat list.
2. Read the list: sessions that need you come first, then working ones. A Terminal session shows its steps and cost.
3. Type to filter by title, project, agent or state.
4. Press **↑** or **↓**, then **Enter**. **Esc** closes.

**Next:** [Pick the model, effort and mode](agent-mode.md)
