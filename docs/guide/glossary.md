---
title: Glossary
section: Reference
type: reference
order: 922
summary: Short definitions of the words Spark Outpost uses - agent, mode, autonomy, crew, piece, worktree, Jev and more.
---

## Agents and the crew

| Term                      | Means                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Agent**                 | The AI that reads and writes code: Claude Code, Codex or Z.ai.                                        |
| **Provider**              | Where an agent comes from: Claude, Codex or Z.ai.                                                     |
| **Reader**                | The crew member that answers without changing anything.                                               |
| **Builder**               | The crew member that makes a change.                                                                  |
| **Critic**                | The crew member that reviews a change.                                                                |
| **Coordinator**           | The crew member that splits big work into pieces and joins them.                                      |
| **Piece**                 | One Builder's share of a big plan, such as **P1**. See [How pieces work](how-pieces-work.md).         |
| **Jev**                   | An optional advisor from TypeSafe. Without it, Spark's rules decide. See [Jev](jev.md).               |
| **Spark**                 | The assistant layer around the agents. Also a named teammate you make. See [Make a Spark](sparks.md). |
| **Standing instructions** | What a Spark follows in every chat.                                                                   |
| **Scout**                 | Spark's blob on Spark Island and in the app's corner.                                                 |

## Control

| Term                   | Means                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| **Agent mode**         | The provider's own permission setting. See [Agent modes](modes-and-levels.md#agent-modes).  |
| **Spark autonomy**     | What Spark does with finished work: **Automatic** or **Full auto → PR**.                    |
| **Approval card**      | A card asking before a command or edit. See [Answer an approval card](answer-approvals.md). |
| **Protected path**     | Something that always asks or is refused. See [Protected paths](protected-paths.md).        |
| **Ran without review** | An action taken in a mode that never asks, recorded in the audit.                           |
| **Guardrail**          | A rule Spark enforces around every Builder. See [Guardrails](guardrails.md).                |
| **Why-line**           | The line that says which model a Builder got and why.                                       |

## Chats and projects

| Term             | Means                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| **Project**      | A folder you linked. A chat can link more than one repo.                                       |
| **Worktree**     | A separate copy of the repo on its own branch, one per chat.                                   |
| **Turn**         | One request and the agent's work on it.                                                        |
| **Context**      | How much of a conversation a model can hold at once.                                           |
| **Compaction**   | Replacing a long chat's context with a summary. See [Manage a long chat](compaction.md).       |
| **Pinned model** | The model you picked for a chat. See [How Spark picks a model](model-routing.md).              |
| **Effort**       | How hard the agent thinks: Low to Max.                                                         |
| **Work panel**   | The chat's side panel: plan, crew, changes, cost.                                              |
| **Agent TV**     | A live view of a chat's agents. See [Watch the crew](agent-tv.md).                             |
| **Ship**         | Commit, push or open a pull request. See [Ship a change](ship-and-pull-requests.md).           |
| **Area**         | A group of related files on the Map: **Core**, **Shared** or **Feature**.                      |
| **MCP server**   | An external tool server an agent can call, added in **Settings → MCP servers**.                |
| **Spark tools**  | The `spark_*` tools agents use to look things up. See [Spark tools](spark-tools.md).           |
| **Spark Island** | The Mac app's panel at the top of the screen. See [Set up Spark Island](desktop-companion.md). |
