---
title: Guardrails
section: Understand Spark
type: concept
order: 826
summary: Five rules Spark applies around every Builder, and how to read the Worth a look list they produce.
---

A guardrail is a rule Spark enforces itself, in every chat and every agent mode. Agents can't switch them off, and they never block you: they point out what's worth a look.

| Guardrail                       | What Spark does                                                             | Where you see it            |
| ------------------------------- | --------------------------------------------------------------------------- | --------------------------- |
| **No unexplained removals**     | Flags code a Builder removed without being asked and without saying why.    | **Worth a look**            |
| **Checks Spark runs itself**    | Trusts its own check run over the Builder's word, and flags weakened tests. | **Worth a look**            |
| **Estimates from your history** | Estimates time and cost from your past runs.                                | **Build this plan?** card   |
| **Budgets that fit the task**   | Gives each Builder a tool-call and time budget, then stops and asks.        | Builder header, budget card |
| **Models that keep passing**    | Stops sending a kind of task to a model that keeps failing it.              | Builder header, why-line    |

For the last three, see [Estimates and budgets](estimates-and-budgets.md).

## Worth a look

The kept card in the chat and the final reply list flags under **Worth a look**. A card that waits for you says **Worth a look before you keep this**, and at **Full auto → PR** the list is in the PR description too.

![A kept card with its Worth a look list](images/guardrails-keep-card-light.png)

| Flag                                                 | Means                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| "Removed `helperTotals` … — why?"                    | A file, function, export, test or safety check was removed without a reason.       |
| "… said the checks pass, but Spark's own run failed" | The Builder's claim and Spark's run disagree. Spark's run counts.                  |
| Weakened tests                                       | A test gained `skip` or `only`, lost assertions or got a looser matcher.           |
| Updated snapshots                                    | Check that they match the behaviour you want.                                      |
| Check config                                         | Lint, typecheck, test or CI config, or a `test`, `lint` or `build` script changed. |
| Files nobody named                                   | A changed file that the request, the plan and the Builder never mentioned.         |

A removal isn't flagged when you asked for it, the Builder explained it, or the code only moved or was renamed. When a Critic reviews, it makes the call on each removal.

If a flag is expected, say so in your request, such as "update the snapshots". To undo a run, see [Review, keep or revert changes](review-changes.md).
