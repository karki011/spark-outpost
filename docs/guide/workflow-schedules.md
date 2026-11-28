---
title: Run a workflow on a schedule
nav: Run on a schedule
section: Chats
type: how-to
order: 235
summary: Have a workflow start by itself every N minutes, hours, days or weeks, and see what ran, what was skipped and what was held.
---

A scheduled workflow starts on its own while Spark is open on your Mac. About 2 minutes.

1. Open **Sparks**, then **Workflows**, and choose **Edit** on a workflow.
2. Open **When it runs**. Under **On a schedule**, set **Every** and its unit.
3. Pick days under **Only on** if it shouldn't run every day.
4. For minutes and hours, set the hours it runs **between**. For days and weeks, set the time.
5. Write **What to tell the workflow**. Under **Where**, pick a **Project**.
6. Turn on **Run on a schedule**, then choose **Save**.

**Next runs** lists the next three times and an estimate of runs and cost a day. The estimate is not a limit.

## What happens when

| When                              | What Spark does                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------- |
| The Mac slept or Spark was closed | **Run once when back** starts one run, however many were missed. **Skip** none. |
| The schedule's last run is going  | Skips the time and says so on the **Runs** tab. Runs in other chats don't.      |
| [Spark is paused](pause-spark.md) | Holds the time. On resume it starts one run, or none with **Skip**.             |
| The workflow or project is gone   | Doesn't start, and the **Runs** tab says why.                                   |
| You delete the workflow           | Its schedule is deleted with it.                                                |

## Where runs go

Every run is a turn in one chat named after the workflow, in the project you picked. With **Any project**, that chat has no project. Spark doesn't archive that chat for inactivity while the schedule is on.

A finished run is an update, never something that needs you. Home shows one line per schedule, such as "Pre-PR review: 12 runs today, 1 failed".

> **Important:** A scheduled run is not your message. It can't ask for a push, a pull request or a Spark action.

Schedules are set on the Mac only.

**Next:** [Pause automatic work](pause-spark.md)
