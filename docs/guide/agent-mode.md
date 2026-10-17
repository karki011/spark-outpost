---
title: Pick the model, effort and mode
section: Chats
type: how-to
order: 212
summary: Pin a model or let Auto pick, set how hard the agent thinks, and choose what it may do without asking in one chat.
---

You'll choose the model, effort and permissions for one chat. About 1 minute.

## Pick a model

1. Select the model button in the message box. The picker opens on **Model**.
2. With several providers connected, switch **AI provider** at the top.
3. Pick a model to pin it, or **Auto** for the provider's default.

![The model picker open on the Model tab](images/chats-and-modes-picker-light.png)

Models your sign-in can't use are left out; a pinned one shows **Unavailable** and **Switch to …**.

A pinned name such as `sonnet` runs the agent's current model of that name; the button shows the model that ran.

A new chat starts on **Auto**; earlier chats keep their setting. The agent picks models for its own sub-agents.

## Set the effort

1. Select the **Effort** tab.
2. Pick a level, from **Low** (quick) to **Max** (deepest and slowest).

Higher effort is slower and costlier.

## Pick the agent's mode

1. Select the **Permissions** tab, or the permissions chip next to the model button.
2. Pick a mode under **Agent mode**. The provider's default has a **Default** tag.

![The Permissions tab listing Claude's modes](images/chats-and-modes-permissions-light.png)

| You want                             | Claude and Z.ai        | Codex              |
| ------------------------------------ | ---------------------- | ------------------ |
| Answers only, nothing changes        | **Plan**               | **Read-only**      |
| To approve every edit and command    | **Manual**             | **Ask every time** |
| Edits to go through, commands to ask | **Accept edits**       | none               |
| The agent to decide what to ask      | **Auto**               | **Approve for me** |
| No questions from the agent          | **Bypass permissions** | **Full access**    |

A read-only mode never changes files: switch modes, then ask for the change.

> **Important:** No mode switches off the [protected paths](protected-paths.md). Modes that never ask are recorded as [ran without review](approvals.md#actions-that-ran-without-review).

These choices apply to this chat. For new chats, see [Change defaults](providers-and-models.md#change-defaults-or-the-default-provider).

**Next:** [Choose how much Spark does alone](spark-autonomy.md)
