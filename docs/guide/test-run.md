---
title: Do a test run
section: Chats
type: how-to
order: 230
summary: Try a workflow or one Spark with real agents on a throw-away copy of a project. Nothing is pushed, posted or saved, and the copy is deleted when you close it.
---

See what a workflow or one Spark would do before it can send anything. About 2 minutes.

## Start one

1. Select **Sparks** in the left bar.
2. For a workflow, open it on **Workflows** and select **Test run**. Save your changes first.
3. For one Spark, open its card and find **Try it** under **Details**.
4. Pick the **Project to copy**, or **No project**, and say what the run is about.
5. Select **Start test run** or **Try it**.

Spark copies the project's last commit into a worktree and runs the steps there. Changes you haven't committed are not in the copy. A project that is not a git repository can't be copied.

## Read the result

| You see                  | It means                                                                |
| ------------------------ | ----------------------------------------------------------------------- |
| **Steps**                | Each step's state. Select one to read its **Step output**.              |
| **Would have been sent** | What a step tried to send. Spark refused it and marked it **Not sent**. |
| **Allow once**, **Deny** | A step's command is waiting for your OK, as its agent's mode asks.      |
| The line in the banner   | Steps done, time, tokens and cost.                                      |

Held back: pushes, pull requests, ticket, Slack and calendar changes, other Spark tools that write, opening a Browser pane page and commands that send. Reads still work, as do the agent's own web tools.

## Finish

1. Select **Discard**, or leave the view. Spark deletes the copy, the run and its hidden chat.
2. For a workflow, select **Run for real** to start an ordinary run with the same message and project.

A test run never shows in your chats, History, Updates or the island. One left open when Spark quits is deleted at the next start.

> **Important:** Tokens are spent and the cost is real. A script that reaches an outside service by itself is not stopped by Spark.

**Next:** [Make a Spark](sparks.md)
