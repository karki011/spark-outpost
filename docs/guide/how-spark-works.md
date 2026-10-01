---
title: Spark at a glance
section: How Spark works
order: 191
summary: What Spark adds on top of Claude, Codex and Z.ai, in one short paragraph each, with links to the details.
---

You'll get a one-page map of what Spark does around your AI agent. About 3 minutes.

Claude Code, Codex and Z.ai are the agents that read and write code. Spark is the layer around them: it decides who works on a request, checks the work, keeps you in charge, and ships the result. Turn it off with the **Spark** switch in **Settings → Spark**, and chats go straight to the agent.

## A crew instead of one agent

Spark gives each request the smallest crew that fits: a **Reader** answers questions, a **Builder** makes changes, and a **Critic** reviews bigger or riskier ones, on another provider when one is connected. See [The Spark crew](spark-crew.md).

## Pieces for big work

Work too big for one Builder goes to a **Coordinator**. It splits the work into pieces, runs Builders side by side, joins their work and runs the checks once. See [Big work in pieces](pieces.md).

## Worktrees keep your checkout safe

Each chat that changes code works in its own git worktree on a new branch. Your own checkout stays as it is until you bring the changes in or ship them. See [Where Spark works](spark-crew.md#where-spark-works).

## The right model for each request

Pin a model, or let **Auto** pick one per request: smaller for trivial edits, the top model for risky work, and a score in between. See [Pick a model for a chat](auto-routing.md).

## Jev, the optional advisor

Jev reads each request and rates it, helps triage pull request comments and checks finished changes. Without Jev, rules do the same jobs. See [Jev, Spark's advisor](jev.md).

## Two dials for control

The agent's **mode** decides what the agent may do without asking. **Spark autonomy** decides what Spark keeps, checks and ships by itself. See [Permissions and autonomy](permissions-and-autonomy.md).

## Approvals and protected paths

Approval checks run in Spark, not in the model. Secret files, agent instruction files, git hooks, force pushes and sending data out always ask, in every mode. See [Approvals and protected paths](approvals.md).

## Guardrails on every Builder

Spark runs the checks itself, flags unexplained removals and weakened tests, estimates time and cost, gives each Builder a budget, and stops using models that keep failing. See [Guardrails (universal laws)](guardrails.md).

## Long chats stay usable

When a chat's context gets full, Spark compacts it to a summary and keeps the full transcript. See [Long chats and compaction](compaction.md).

## Ship and follow up

Ship commits, pushes or opens a pull request. Spark then fixes failing checks and answers review comments on its PRs, up to 3 rounds, and never merges. See [Ship and pull requests](ship-and-pull-requests.md) and [Follow up on pull requests](pr-follow-up.md).

> **Tip:** To see all of this in order for one request, read [What happens when you send a prompt](prompt-flow.md).

**Next:** [What happens when you send a prompt](prompt-flow.md)
