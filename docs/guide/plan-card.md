---
title: Answer a plan
section: Chats
type: how-to
order: 220
summary: Read the Build this plan? card, then build it, edit it or stop - and know when it builds by itself.
---

You'll review a plan before anything changes. About 1 minute.

Spark plans first when you type `/plan`, or when the work is big or destructive.

1. Read the plan on the **Build this plan?** card. It shows a time and cost [estimate](guardrails.md#estimates).

   ![The Build this plan? card with Build, Edit and Stop](images/spark-crew-plan-light.png)

2. Select **Build** to start the work, **Edit** to change the plan, or **Stop**.

After **Build**, the work runs by itself.

## When the card waits

| Autonomy           | Ordinary plan                                                 | Destructive plan |
| ------------------ | ------------------------------------------------------------- | ---------------- |
| **Automatic**      | Waits for you, in every agent mode                            | Waits for you    |
| **Full auto → PR** | Builds after a countdown, such as "Building this plan in 10s" | Waits for you    |

At **Full auto → PR**, select **Edit** or **Stop** before the countdown ends to hold the plan. The countdown is the **Wait before going with best guesses** time, or 30 seconds when that setting is **Never**.

A destructive plan deletes, drops or truncates data. Its card says "this would change data permanently".

> **Tip:** **Save as agreed plan** under a reply makes that reply the chat's plan.

**Next:** [Review, keep or revert changes](review-changes.md)
