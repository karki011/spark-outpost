---
title: Agent modes and autonomy levels
section: Reference
type: reference
order: 612
summary: Every agent mode for Claude, Codex and Z.ai, what each allows, and the two Spark autonomy levels.
---

The agent's mode is the provider's own setting, shown with the provider's names. To change them, see [Pick the mode](agent-mode.md#pick-the-agents-mode) and [Choose how much Spark does alone](spark-autonomy.md).

## Agent modes

| What it allows                  | Claude and Z.ai        | Codex              | Approval cards you see              |
| ------------------------------- | ---------------------- | ------------------ | ----------------------------------- |
| Reads only                      | **Plan**               | **Read-only**      | None. Switch modes to change files. |
| Asks before edits and commands  | **Manual**             | **Ask every time** | One for each edit and each command. |
| Edits freely, asks for commands | **Accept edits**       | none               | One for each command.               |
| Decides what to ask             | **Auto**               | **Approve for me** | Only what the agent asks about.     |
| Never asks                      | **Bypass permissions** | **Full access**    | None from the agent.                |

| Provider | Default mode       | Default effort |
| -------- | ------------------ | -------------- |
| Claude   | **Auto**           | High           |
| Codex    | **Approve for me** | Medium         |
| Z.ai     | **Manual**         | High           |

## What Spark does in each mode

| Mode                                                        | Spark                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Read-only modes                                             | Runs read-only commands directly. Refuses file changes.                                           |
| Modes that ask                                              | Shows the agent's card with the agent's reason. Adds no ask rules of its own.                     |
| **Bypass permissions**, **Approve for me**, **Full access** | Marks each action **ran without review** and flags protected-path crossings. Never stops the run. |
| A mode Spark doesn't recognise                              | Lets the agent decide when to ask.                                                                |
| Every mode                                                  | Enforces the [protected paths](protected-paths.md).                                               |

## Agent tools

Agents use their own tools, such as web search, per mode. Web tools never open this computer's addresses.

Turn one off with `permissions.deny` in `~/.claude/settings.json`, a project's `.claude/settings.json` or managed settings; Codex: `config.toml`. Spark reads only `deny` and `ask` there.

## Autonomy levels

| Level                        | Plans                         | Keeping changes | Shipping                        |
| ---------------------------- | ----------------------------- | --------------- | ------------------------------- |
| **Automatic**                | Only the agent's own approval | Kept by itself  | You ship                        |
| **Full auto → PR** (default) | Only the agent's own approval | Kept by itself  | The agent pushes and opens a PR |

The level doesn't choose [where the chat works](where-spark-works.md).
