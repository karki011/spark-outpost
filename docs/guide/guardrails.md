---
title: Guardrails and estimates
section: Understand Spark
type: concept
order: 520
summary: The Worth a look list Spark adds to kept changes, the estimate for a build, and model demotions.
---

A guardrail is a rule Spark enforces itself, in every chat and agent mode. Guardrails never block you: they point out what's worth a look. Outposts have their own rules: [requests](outpost-permissions.md) and [stacked pull requests](stacked-pull-requests.md).

## Worth a look

The result line and the final reply list flags under **Worth a look**. At **Full auto → PR** the list is in the PR description too.

![A kept result with its Worth a look list](images/guardrails-keep-card-light.png)

| Flag                                                 | Means                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| "Removed `helperTotals` … — why?"                    | A file, function, export, test or safety check was removed without a reason.       |
| "… said the checks pass. Spark's own run differs: …" | Names the command and what failed. Spark's own run counts.                         |
| Weakened tests                                       | A test gained `skip` or `only`, lost assertions or got a looser matcher.           |
| Updated snapshots                                    | Check that they match the behaviour you want.                                      |
| Check config                                         | Lint, typecheck, test or CI config, or a `test`, `lint` or `build` script changed. |
| Files nobody named                                   | A changed file that the request, the plan and the Builder never mentioned.         |

If a flag is expected, say so in your request, such as "update the snapshots".

## Estimates

A build records a **Rough estimate** of time and cost with the turn's decisions. After 5 similar finished runs it shows a **Learned estimate**, from your own history.

An estimate is only information. Spark sets no budget on time, tool calls or cost: a task runs until it finishes or you stop it.

## Model demotions

On **Auto**, Spark stops sending a kind of task to a model whose recent pass rate falls well behind its tier, after at least 10 finished runs.

The Builder's header says why. A pinned model stays.
