---
title: Start a chat and link a project
section: Chats
type: how-to
order: 210
summary: Start chats, link projects and attach context.
---

About 1 minute.

## Start a chat

1. Select **Chats** in the rail, then **New chat** (**⌘⇧O**).
2. Leave **Chat** selected, type your message and press **Enter**.

![A new chat with project and branch under the message box](images/chats-and-modes-new-chat-light.png)

Or use **Start a new chat** on **Home**.

Pick **Terminal** for the native CLI: [Open a terminal](terminals.md).

While loading, drafts stay editable; sending waits. **Try again** recovers failed loads.

## Link a project

Without one, the agent works in a private folder; files show under replies.

1. Under the box, select **Choose project**.
2. Pick a folder under **Recent**, **Add folder…** to pick or make one, or **Clone a repository…**.

Plain folders offer **Make it a git repository**.

![The message box with a linked project, its branch and agent setup](images/chats-and-modes-project-light.png)

**No project folder** unlinks it.

## Write a message

| Type or select                    | To                                                                       |
| --------------------------------- | ------------------------------------------------------------------------ |
| **@**                             | Add a file from the project                                              |
| **/**                             | Run a command: `/plan`, `/review`, `/model`, `/effort`, `/mcp`, `/fresh` |
| **+** (**Add files and context**) | **Upload a file**, **Add a screenshot**, **Add from repo**, another chat |

**Sent** confirms receipt; **Retry** reuses the message ID.

Markdown styles as you type; select text or open **+ → Formatting** ([keys](keyboard-shortcuts.md#chats)). Agent setup is in **…** under the box.

## Share a chat with another chat

Paste a link from **Chat actions → Copy chat link** into another chat; the agent can [read it](spark-tools.md), never change it.

Group chats in an [outpost](outposts.md).

> **Tip:** Bring in a [Spark](sparks.md) teammate.

## Open two chats side by side

**⌥**-click a chat (**⌥Enter**) or use **Open in split**. Clicking or typing in a side focuses it; opened chats, **⌘D** and panels go there. The other dims, still working. **✕** closes.

## Jump between sessions

1. Press **⌘⇧K** or select **Sessions**.
2. Needs-you chats come first; Terminal sessions show steps and cost.
3. Filter by title, project, agent, state or message.
4. **↑** **↓** and **Enter** open one, at a message match. **Esc** closes.

**Next:** [Pick the model, effort and mode](agent-mode.md)
