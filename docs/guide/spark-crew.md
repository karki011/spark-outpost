---
title: The Spark crew
section: Understand Spark
type: concept
order: 818
summary: Who reads, builds and reviews your request, how Spark decides what to do with it, and when a Critic reviews.
---

Spark gives each request the smallest crew that fits. Most requests need only a Reader or one Builder; a Critic and a Coordinator join for bigger or riskier work.

| Role            | What it does                                                   | Names                        |
| --------------- | -------------------------------------------------------------- | ---------------------------- |
| **Reader**      | Reads the project and answers. Changes nothing.                | Pip, Wren, Skye              |
| **Builder**     | Makes the change.                                              | Bolt, Rivet, Tack, Chip, Nut |
| **Critic**      | Reviews the change, on another provider when one is connected. | Hawk, Owl, Lynx              |
| **Coordinator** | Splits big work into pieces and joins them.                    | Atlas, Juno, Vega            |

To watch them, see [Watch and message the crew](agent-tv.md).

## How Spark decides what to do

A line above the crew says what Spark chose:

| Line                         | When                                           | What happens                          |
| ---------------------------- | ---------------------------------------------- | ------------------------------------- |
| **Answer directly**          | A question or research                         | A Reader answers. Nothing changes.    |
| **Build it**                 | A clear change                                 | A Builder makes it.                   |
| **Plan, then build**         | A plan request, or a big or destructive change | You get a [plan](plan-card.md) first. |
| **Plan, build, then review** | The same, when a review is warranted           | A Critic reviews at the end.          |

If the request is too vague, the agent first asks 1 to 3 questions with its best guesses.

With [Jev](jev.md) connected, Jev helps make these calls. Without it, Spark's rules decide from the wording.

## When the Critic reviews

A Critic reviews large diffs, changes to 3 or more source files, migrations, destructive or high-stakes work, a build from an agreed plan, or when you ask. A one-line fix never gets one.

- A Builder fixes the Critic's findings, up to 3 rounds.
- After a fix, the Critic only rechecks: it confirms the earlier problems are fixed and looks at what the fix changed.
- Hardening ideas you didn't ask for are listed under **Not fixed automatically** instead of starting another round.
- If the Critic fails to run, Spark retries once, on your chat's provider. If that fails too, the reply says "Review skipped (Critic unavailable: …)" and the change is kept as usual.
