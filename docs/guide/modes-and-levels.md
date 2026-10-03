---
title: Agent modes and autonomy levels
section: Reference
type: reference
order: 912
summary: Every agent mode for Claude, Codex and Z.ai, what each allows, and the two Spark autonomy levels.
---

The agent's mode is the provider's own setting, shown with the provider's names. Spark autonomy is Spark's. To change them, see [Change the agent's mode](agent-mode.md) and [Choose how much Spark does alone](spark-autonomy.md).

## Agent modes

| What it allows                  | Claude and Z.ai        | Codex              | Approval cards you see                      |
| ------------------------------- | ---------------------- | ------------------ | ------------------------------------------- |
| Reads only                      | **Plan**               | **Read-only**      | None. **Make the change** runs it for real. |
| Asks before edits and commands  | **Manual**             | **Ask every time** | One for each edit and each command.         |
| Edits freely, asks for commands | **Accept edits**       | none               | One for each command.                       |
| Decides what to ask             | **Auto**               | **Approve for me** | Only what the agent asks about.             |
| Never asks                      | **Bypass permissions** | **Full access**    | None from the agent.                        |

| Provider | Default mode       | Default effort |
| -------- | ------------------ | -------------- |
| Claude   | **Auto**           | High           |
| Codex    | **Approve for me** | Medium         |
| Z.ai     | **Manual**         | High           |

The chip shows **Bypass permissions** as **Bypass**, and tints it and **Full access** as a warning.

## What Spark does in each mode

| Mode                                                        | Spark                                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Read-only modes                                             | Runs read-only commands directly. Refuses file changes.                                                                                    |
| Modes that ask                                              | Shows the agent's card with the agent's reason. Adds no ask rules of its own.                                                              |
| **Bypass permissions**, **Approve for me**, **Full access** | Can't see their requests, so it watches: marks each action **ran without review** and flags protected-path crossings. Never stops the run. |
| A mode Spark doesn't recognise                              | Lets the agent decide when to ask. Never stops a run for it.                                                                               |
| Every mode                                                  | Enforces the [protected paths](protected-paths.md).                                                                                        |

## Autonomy levels

| Level                   | Plans                   | Keeping changes | Shipping                                 | Where it works                |
| ----------------------- | ----------------------- | --------------- | ---------------------------------------- | ----------------------------- |
| **Automatic** (default) | Wait for **Build**      | Kept by itself  | You ship                                 | Risky work in a worktree copy |
| **Full auto → PR**      | Build after a countdown | Kept by itself  | Spark opens a PR, a draft if checks fail | A worktree copy               |

Both levels keep **Revert to before this run**, and neither ever merges.

## Actions agents propose

Spark's own action tools, such as creating a ticket or opening a PR, follow both settings. See [When actions ask first](spark-tools.md#when-actions-ask-first).
