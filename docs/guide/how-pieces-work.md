---
title: How pieces work
section: Understand Spark
type: concept
order: 820
summary: When Spark splits a plan between several Builders, where each piece runs, and how the pieces are joined.
---

When an agreed plan is too big for one Builder, a Coordinator splits it into pieces, one Builder each. The Coordinator joins the pieces, runs the full checks once, and the Critic reviews the whole change.

## How many Builders

With Jev connected, Jev picks 1 to 4 Builders for the plan. Spark never uses more than the plan has items, or more than **Builders at once** allows.

Without Jev, or when Jev isn't sure, rules split the work when:

- you ask, for example "split this up";
- the plan has 4 or more steps across 2 or more parts of the project;
- the change likely touches 12 or more files, or 3 or more packages.

Otherwise one Builder does the whole plan, with no Coordinator.

## How items are grouped

- Items that change the same files stay together.
- Data or migration work, and anything the request deletes or renames, never shares a Builder with other work.
- Items in different projects never share a Builder.

Each piece has a key such as **P1**, a Builder and the files it owns. A Builder may change only its own files, and it can't commit, merge or switch branches.

## Where pieces run

| Where                | Means                                                             | Spark uses it when                                               |
| -------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| **in order**         | One Builder at a time                                             | Pieces depend on each other, or side by side saves little        |
| **shared tree**      | Builders side by side in the chat's folder, each on its own files | Pieces are independent, with no risky files                      |
| _Builder_**'s copy** | Each Builder in its own worktree copy, merged back when done      | Data or migration work, lockfiles or manifests, package installs |

Builders that share a folder at the same time have their edits and commands checked by Spark, so each stays in its own files. Single pieces and pieces in their own copies follow the agent's mode.

If two copies clash, Spark tries to merge them. If it can't, you get a card. At **Full auto → PR**, Spark stops and reports the clash instead of guessing.

The line above the piece board shows the choice, such as "Jev: 2 Builders (0.84) · P1 Claude Opus 5.5, worktree". To steer pieces, see [Steer big work in pieces](pieces.md).
