---
title: Follow a workflow run
section: Chats
type: how-to
order: 230
summary: Run a workflow from the Sparks page and follow each step live, read a step's output, stop the run and open past runs.
---

Run a workflow and watch its steps finish. About 2 minutes.

## Run one

1. Select **Sparks** in the left bar, then **Workflows**.
2. Select **Run** on a workflow. The run view opens. The run happens in its own chat.
3. Read the line under the title: the run's state, steps done, time, tokens and cost.

Typing `@` and the workflow's id in a chat also starts it. That turn shows **Open run view**. `@pip-review` runs that workflow even with a Spark named Pip.

## Read a step

1. Select a step under **All steps**. The graph is a picture of the same steps; a solid line means that hand-off happened.
2. Read its Spark, agent, mode, time and **Output**. **Passed to** names the steps that got its note.
3. Select **Open this step in the chat** to see everything it did.

| A step says   | It means                                                                  |
| ------------- | ------------------------------------------------------------------------- |
| **Waiting**   | Steps before it are not done.                                             |
| **Running**   | Its Spark is working.                                                     |
| **Needs you** | It asked to run something. Select **Open the card** and answer it there.  |
| **Done**      | It finished and passed its note on.                                       |
| **Failed**    | It failed. A step set to stop the workflow ends the run.                  |
| **Skipped**   | It never started, because a step before it failed or the run was stopped. |
| **Cancelled** | It was working when the run was stopped.                                  |

## Stop it, or look back

- **Stop** cancels the steps that are working and skips the rest.
- **Outcome unknown** means Spark stopped while the run was going. Read the chat before you run it again.
- Each workflow's row shows its last run. **Edit** opens the workflow, where **Runs** lists every run, newest first, with how it started, its state, time and cost.

Cost shows only when the provider reported one or Spark could estimate it. Runs start on the Mac only.

**Next:** [Make a Spark](sparks.md)
