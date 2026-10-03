---
title: Spark at a glance
section: Understand Spark
type: concept
order: 810
summary: What Spark adds around Claude, Codex and Z.ai, one line each, with a link to the details.
---

Claude Code, Codex and Z.ai are the agents that read and write code. Spark is the layer around them: it decides who works on a request, checks the work, keeps you in charge and ships the result.

| Spark adds         | What it does                                                                             | Read more                                               |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| A crew             | Gives each request the smallest team that fits: a Reader, a Builder, sometimes a Critic. | [The Spark crew](spark-crew.md)                         |
| Pieces             | Splits big work between Builders and joins it.                                           | [How pieces work](how-pieces-work.md)                   |
| Worktrees          | Each chat changes code in its own copy, so your checkout stays as it is.                 | [Choose where a chat works](where-spark-works.md)       |
| Model choice       | Pins your model, or picks one per request on **Auto**.                                   | [How Spark picks a model](model-routing.md)             |
| Two dials          | The agent's mode and Spark autonomy decide how much happens without you.                 | [Permissions and autonomy](permissions-and-autonomy.md) |
| Approvals          | Follows the agent's mode and adds a few hard rails that always ask.                      | [How approvals work](approvals.md)                      |
| Guardrails         | Runs the checks itself, flags odd removals, sets budgets.                                | [Guardrails](guardrails.md)                             |
| Compaction         | Keeps long chats inside the model's context.                                             | [Manage a long chat](compaction.md)                     |
| Ship and follow-up | Opens the pull request, then fixes checks and answers reviews. Never merges.             | [Ship a change](ship-and-pull-requests.md)              |
| Jev, optional      | An advisor that rates requests and checks changes. Without it, rules do the same jobs.   | [Jev, the optional advisor](jev.md)                     |

## With Spark off

Turn off the **Spark** switch in **Settings → Spark** and chats go straight to the agent and model you pick. There's no reading step, crew, Critic or Jev call. Approvals and protected paths still apply.

To see all of this in order for one request, read [What happens when you send a message](prompt-flow.md).
