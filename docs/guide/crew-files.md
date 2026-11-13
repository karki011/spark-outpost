---
title: Spark, skill and workflow files
section: Reference
type: reference
order: 619
summary: The formats of a Spark's folder, a skill's SKILL.md and a workflow file, and how an agent reads and proposes changes to them.
---

A Spark's instructions, skills and scripts are files in its folder, and a workflow is one JSON file. You edit them on the [Sparks page](sparks.md); an agent reads them with `spark_crew` and proposes changes with `spark_crew_edit`.

## A Spark's folder

| Path                     | Holds                                                         |
| ------------------------ | ------------------------------------------------------------- |
| `SPARK.md`               | The Spark's instructions, as plain Markdown. No length limit. |
| `skills/<name>/SKILL.md` | One skill: a name, a description and what to do.              |
| `skills/<name>/<file>`   | Scripts and notes the skill uses.                             |
| Any other file           | Notes the instructions point to.                              |

| Limit  | Value                                                                           |
| ------ | ------------------------------------------------------------------------------- |
| Files  | 200 per Spark, each plain text up to 256 KB                                     |
| A path | Up to 200 characters and 6 folders deep, with forward slashes                   |
| A name | Letters, numbers, dots, hyphens and underscores; starts with a letter or number |

## SKILL.md

```markdown
---
name: release-notes
description: Write release notes from merged pull requests.
---

List the pull requests merged since the last tag, then group them.
```

| Field         | Rule                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------ |
| `name`        | The folder's name: 2 to 40 lower-case letters, numbers and hyphens, starting with a letter |
| `description` | One line, up to 300 characters. The Spark sees it and reads the file when a job needs it   |

A skill folder without a valid `SKILL.md` is not offered to the Spark.

## A workflow file

```json
{
  "id": "nightly-review",
  "name": "Nightly review",
  "steps": [
    { "id": "look", "sparkId": "<Spark id>" },
    { "id": "write", "sparkId": "<Spark id>", "dependsOn": ["look"], "prompt": "Summarise it." }
  ]
}
```

| Field       | Rule                                                                               |
| ----------- | ---------------------------------------------------------------------------------- |
| `id`        | The file's name, in the same form as a skill name                                  |
| `name`      | Up to 60 characters                                                                |
| `steps`     | 1 to 100, each with its own `id` and a `sparkId`                                   |
| `prompt`    | Optional extra words for the step, up to 4,000 characters                          |
| `dependsOn` | Steps this one runs after. Steps with none start together. No step waits on itself |
| `join`      | `all` (default) waits for every parent; `any` starts after the first               |
| `onFailure` | `stop` (default) stops the workflow; `continue` lets later steps run               |

## What an agent can do

| Tool              | Does                                                                                         | Asks                                    |
| ----------------- | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| `spark_crew`      | Lists Sparks with skills, and workflows; reads a Spark's file list, one file or one workflow | Never                                   |
| `spark_crew_edit` | Proposes new, changed or deleted files for one Spark, or a new, changed or deleted workflow  | Always, with each file before and after |

In `spark_crew_edit`, a step may name its Spark with `spark`, `text: null` deletes a file, and `remove` deletes a skill folder or a workflow.

A change with a problem goes back to the agent and is never shown to you.

The card is titled **Change the** _name_ **Spark?** or **workflow?**. Only you answer it, with **Allow** or **Deny**, on the Mac. If a file changed after the card appeared, nothing is written.

Agents get these tools in a chat turn you typed on the Mac; Ask Spark only reads. See [protected paths](protected-paths.md).
