---
title: Change the agent's mode
section: Chats
type: how-to
order: 212
summary: Pick what the agent may do without asking you in one chat: only read, ask before each step, or act on its own.
---

You'll choose how much the agent may do without asking in this chat. About 1 minute.

1. In the message box, select the permissions chip next to the model button. It shows the current mode, such as **Auto**.
2. The picker opens on the **Permissions** tab. Pick a mode under **Agent mode**. The provider's default has a **Default** tag.

   ![The Permissions tab listing Claude's modes](images/chats-and-modes-permissions-light.png)

3. Read the line under the list. It sums up the result, for example "Agent only reads · nothing changes".

The mode applies to this chat. To change it for new chats, see [Choose defaults for new chats](chat-defaults.md).

## Which mode to pick

| You want                             | Claude and Z.ai        | Codex              |
| ------------------------------------ | ---------------------- | ------------------ |
| Answers only, nothing changes        | **Plan**               | **Read-only**      |
| To approve every edit and command    | **Manual**             | **Ask every time** |
| Edits to go through, commands to ask | **Accept edits**       | none               |
| The agent to decide what to ask      | **Auto**               | **Approve for me** |
| No questions from the agent          | **Bypass permissions** | **Full access**    |

In a read-only mode, the agent answers instead of changing files. Select **Make the change** under its answer to run the same request with changes allowed.

**Bypass permissions**, **Approve for me** and **Full access** act without asking. Spark doesn't block them; it records each action as **ran without review** and flags any that cross a protected path. See [How approvals work](approvals.md#actions-that-ran-without-review).

> **Important:** No mode switches off the [protected paths](protected-paths.md). Secret files and agent instruction files always ask.

**Next:** [Choose how much Spark does alone](spark-autonomy.md)
