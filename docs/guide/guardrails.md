---
title: Guardrails
section: Understand Spark
type: concept
order: 520
summary: What Spark enforces itself in every chat and agent mode, what it leaves to the agent, and why nothing is capped.
---

A guardrail is a rule Spark enforces itself, in every chat and agent mode. Everything else is the agent's work: Spark moderates, it doesn't review.

## What Spark enforces

| Guardrail                                                     | Means                                                                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [Protected paths](protected-paths.md)                         | Secret files, agent instructions, git hooks and files outside the project ask or are refused.                               |
| [Publish rules](protected-paths.md#when-an-agent-may-publish) | The agent pushes only the chat's own branch, and only with a reason. Otherwise it's refused.                                |
| Nothing merges                                                | You merge pull requests yourself. Spark never approves or dismisses a review.                                               |
| The audit                                                     | Every action is recorded; one no card covered is marked [ran without review](approvals.md#actions-that-ran-without-review). |
| Revert                                                        | **Revert to before this run** undoes a run's own edits.                                                                     |

Outposts add their own: [requests](outpost-permissions.md) and [stacked pull requests](stacked-pull-requests.md).

## What Spark leaves to the agent

| Not done by Spark            | Instead                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| Running your tests and lint  | The agent runs them. Hooks and CI run on a push; Spark never skips them. |
| Reviewing the diff           | Read it in [**Changes**](review-changes.md), or ask another chat.        |
| Retrying on a stronger model | Stop the turn, then redirect it or pick another model.                   |
| Asking before a build        | Use `/plan` or **Plan** mode to [approve a plan first](plan-card.md).    |

## No budgets

Spark sets no budget on time, tool calls, tokens or cost. Usage is measured and shown; a turn runs until it finishes or you stop it.
