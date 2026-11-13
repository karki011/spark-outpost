---
title: Run a workflow on a schedule
section: Chats
type: how-to
order: 230
summary: Have a workflow start by itself every N minutes, hours, days or weeks, and see what ran, what was skipped and what was held.
---

A scheduled workflow starts on its own while Spark is open on your Mac. About 2 minutes.

1. Open **Sparks**, then **Workflows**, and choose **Edit** on a saved workflow.
2. Open the **Schedule** tab.
3. Set **Every** and its unit. Pick days under **Only on** if it shouldn't run every day.
4. For minutes and hours, set **Only between**. For days and weeks, set **At**.
5. Pick **In project** and write **What to tell the workflow**.
6. Choose **Save schedule**, then turn on **Run on a schedule**.

**Next runs** lists the next three times and an estimate of runs and cost a day. The estimate is not a limit.

## What happens when

| When                              | What Spark does                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------- |
| The Mac slept or Spark was closed | **Run once when back** starts one run, however many were missed. **Skip** none. |
| The previous run is still going   | Skips the time and says so under **Recent runs**.                               |
| [Spark is paused](pause-spark.md) | Holds the time. On resume it starts one run, or none with **Skip**.             |
| The workflow or project is gone   | Doesn't start, and **Recent runs** says why.                                    |
| You delete the workflow           | Its schedule is deleted with it.                                                |

## Where runs go

Every run is a turn in one chat named after the workflow, in the project you picked. Spark doesn't archive that chat for inactivity while the schedule is on.

A finished run is an update, never something that needs you. Home shows one line per schedule, such as "Pre-PR review: 12 runs today, 1 failed".

> **Important:** A scheduled run is not your message. It can't ask for a push, a pull request or a Spark action.

Schedules are set on the Mac only.

**Next:** [Pause automatic work](pause-spark.md)
