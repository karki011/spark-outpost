---
title: Guardrails, estimates and limits
section: Understand Spark
type: concept
order: 520
summary: The Worth a look list Spark adds to kept changes, the estimate on a plan card, the limit on each task, and model demotions.
---

A guardrail is a rule Spark enforces itself, in every chat and agent mode. Guardrails never block you: they point out what's worth a look.

## Worth a look

The kept card and the final reply list flags under **Worth a look**. At **Full auto → PR** the list is in the PR description too.

![A kept card with its Worth a look list](images/guardrails-keep-card-light.png)

| Flag                                                 | Means                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| "Removed `helperTotals` … — why?"                    | A file, function, export, test or safety check was removed without a reason.       |
| "… said the checks pass, but Spark's own run failed" | Spark's own check run counts, not the Builder's word.                              |
| Weakened tests                                       | A test gained `skip` or `only`, lost assertions or got a looser matcher.           |
| Updated snapshots                                    | Check that they match the behaviour you want.                                      |
| Check config                                         | Lint, typecheck, test or CI config, or a `test`, `lint` or `build` script changed. |
| Files nobody named                                   | A changed file that the request, the plan and the Builder never mentioned.         |

If a flag is expected, say so in your request, such as "update the snapshots".

## Estimates

![A Build this plan? card with a rough estimate](images/guardrails-estimate-light.png)

A plan card shows a **Rough estimate** of time and cost. After 5 similar finished runs it shows a **Learned estimate**, from your own history.

## Task limits

Each task has a limit on active time and tool calls, and on cost when you set **Spend cap per task** in **Settings → Spark**. At a limit, Spark stops and shows **Continue past the budget?**.

## Model demotions

On **Auto**, Spark stops sending a kind of task to a model whose recent pass rate falls well behind its tier, after at least 10 finished runs.

The Builder's header says why. A pinned model stays.
