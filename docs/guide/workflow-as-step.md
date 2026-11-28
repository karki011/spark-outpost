---
title: Use a workflow as a step
section: Chats
type: how-to
order: 237
summary: Build one workflow on top of another by adding it as a step, and see how its steps run, fail and show in a run.
---

A step can run a whole workflow, so a bigger workflow reuses smaller ones. About 2 minutes.

## Add one

1. Open **Sparks**, then **Workflows**, and open a workflow.
2. In **Steps**, select **Add a stage** or the picker under a stage.
3. Pick a workflow. Workflows are listed after your Sparks, marked **Workflow**.
4. Select the step and set **Runs after**, **If it fails** and **Extra prompt**.
5. Select **Preview** to see every step in order, then **Save**.

## How it runs

| Part             | What happens                                                                |
| ---------------- | --------------------------------------------------------------------------- |
| Its steps        | They run in place of the step, shown in a run as `workflow › Spark`.        |
| Order            | Its first steps wait on **Runs after**. Later steps wait on its last steps. |
| **Extra prompt** | Added to what every Spark inside is told.                                   |
| **If it fails**  | **Stop workflow** stops the run. **Continue** applies to every step inside. |
| When it runs     | Only its steps are used. Its own schedule and triggers play no part.        |
| Later edits      | Changing it changes later runs of every workflow that uses it.              |

## Limits

- A workflow can't use itself, directly or through another workflow.
- A workflow another one uses can't be deleted. Remove the step first.
- One run has at most 500 steps.

**Next:** [Follow a workflow run](workflow-runs.md)
