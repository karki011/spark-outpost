---
title: Estimates and budgets
section: Understand Spark
type: concept
order: 828
summary: The time and cost estimate on a plan card, the budget each Builder gets, and why Spark stops using a model for a kind of task.
---

Spark estimates a plan's time and cost before it builds, gives each Builder a budget sized to the task, and tracks which models keep passing. All three use your own history, on your computer.

## Estimates on plan cards

![A Build this plan? card with a rough estimate](images/guardrails-estimate-light.png)

| Estimate             | When                                     | Example                                       |
| -------------------- | ---------------------------------------- | --------------------------------------------- |
| **Rough estimate**   | Fewer than 5 similar finished runs       | "Rough estimate: ~6 min, ~$0.40"              |
| **Learned estimate** | 5 or more runs of the same kind and size | "Usually ~6 min, ~$0.40 for a task like this" |

If Spark keeps guessing low, it pads the next estimate and says so, such as "padded ×1.4".

## Budgets and the budget card

Each Builder gets a budget of tool calls and minutes, shown in its header, such as "budget 18 tool calls · 4.5 min".

When a Builder reaches it, Spark stops the Builder and shows **Continue past the budget?**:

- **Continue**: the Builder finishes with no budget for the rest of this run.
- **Stop**: look at the work, or ask for something smaller.

This card never continues by itself, at either autonomy level. **Spend cap per task** in **Settings → Spark** still applies.

## Model demotions

Spark tracks how each model does on each kind of task, such as bug fixes. If a model's recent pass rate falls well behind others of its tier, Spark stops sending that kind of task to it.

- It needs at least 10 finished runs of a kind.
- It only happens on **Auto**. A pinned model stays, and the note ends "pinned, so Spark kept it".
- It isn't permanent. As new runs pass, the rate recovers.

The Builder's header says why, for example "Sonnet 5 has passed 55% of recent bug fixes here".

Ask any agent "what were the estimate and budget for this run?". It reads them with the `spark_laws` tool.
