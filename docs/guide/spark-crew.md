---
title: The crew and pieces
section: Understand Spark
type: concept
order: 514
summary: Who reads, builds and reviews your request, when a Critic reviews, and how big work is split into pieces.
---

Spark gives each request the smallest crew that fits.

| Role            | What it does                                          | Names                        |
| --------------- | ----------------------------------------------------- | ---------------------------- |
| **Reader**      | Answers. Changes nothing.                             | Pip, Wren, Skye              |
| **Builder**     | Makes the change.                                     | Bolt, Rivet, Tack, Chip, Nut |
| **Critic**      | Reviews the change, on another provider if connected. | Hawk, Owl, Lynx              |
| **Coordinator** | Splits big work into pieces and joins them.           | Atlas, Juno, Vega            |

## How Spark decides what to do

| Line above the crew | When                   |
| ------------------- | ---------------------- |
| **Answer directly** | A question or research |
| **Build it**        | A clear change         |

A vague request gets 1 to 3 questions as the reply. [Jev](jev.md) or rules decide. A build's plan is [saved](plan-card.md), not asked about.

## When the Critic reviews

A Critic reviews large diffs, 3+ source files, migrations, destructive or high-stakes work, builds from an agreed plan, or when you ask.

A Builder fixes findings, up to 3 rounds. If the Critic fails, the other provider reviews, or the reply says **Review skipped**.

## Pieces

A Coordinator splits a big plan into pieces such as **P1**, one Builder each. Jev or rules pick 1 to 4 Builders. Jev picks each piece's model. See [Watch and steer the crew](pieces.md).

| Where pieces run | Means                                    | Used for           |
| ---------------- | ---------------------------------------- | ------------------ |
| **in order**     | One Builder at a time                    | Dependent pieces   |
| **shared tree**  | Builders side by side on their own files | Independent pieces |

The Coordinator gives each piece its own files. Spark checks that plan once: two pieces that run at the same time can't own the same file.

Builders share one working tree and follow your agent mode like any other run. If one changes another piece's file, Spark keeps the change, flags it and tells that piece's Builder. The run goes on.
