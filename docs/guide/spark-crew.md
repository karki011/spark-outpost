---
title: The crew and pieces
section: Understand Spark
type: concept
order: 514
summary: Who reads, builds and reviews your request, when a Critic reviews, and how big work is split into pieces.
---

Spark gives each request the smallest crew that fits. A Critic and a Coordinator join for bigger or riskier work.

| Role            | What it does                                          | Names                        |
| --------------- | ----------------------------------------------------- | ---------------------------- |
| **Reader**      | Answers. Changes nothing.                             | Pip, Wren, Skye              |
| **Builder**     | Makes the change.                                     | Bolt, Rivet, Tack, Chip, Nut |
| **Critic**      | Reviews the change, on another provider if connected. | Hawk, Owl, Lynx              |
| **Coordinator** | Splits big work into pieces and joins them.           | Atlas, Juno, Vega            |

See [Watch and steer the crew](pieces.md).

## How Spark decides what to do

| Line above the crew          | When                                                           |
| ---------------------------- | -------------------------------------------------------------- |
| **Answer directly**          | A question or research                                         |
| **Build it**                 | A clear change                                                 |
| **Plan, then build**         | A [plan](plan-card.md) request, or a big or destructive change |
| **Plan, build, then review** | The same, when a review is warranted                           |

A vague request first gets 1 to 3 questions. [Jev](jev.md) helps make these calls; without it, rules decide.

## When the Critic reviews

A Critic reviews large diffs, changes to 3 or more source files, migrations, destructive or high-stakes work, builds from an agreed plan, or when you ask.

A Builder fixes its findings, up to 3 rounds.

## Pieces

A Coordinator splits a big plan into pieces such as **P1**, one Builder each. Jev picks 1 to 4 Builders; without Jev, rules do.

| Where pieces run     | Means                                        | Used for                                            |
| -------------------- | -------------------------------------------- | --------------------------------------------------- |
| **in order**         | One Builder at a time                        | Pieces that depend on each other                    |
| **shared tree**      | Builders side by side, each on its own files | Independent pieces                                  |
| _Builder_**'s copy** | Each Builder in its own worktree copy        | Data or migration work, lockfiles, package installs |

In a shared tree, Spark refuses edits and commands that leave a Builder's own files. A card appears only when your agent mode asks or Spark can't read a command.

If two copies clash, you get a card. At **Full auto → PR**, Spark stops and reports.
