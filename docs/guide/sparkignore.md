---
title: Keep files away from agents
section: Projects and the Map
type: how-to
order: 314
summary: List files in .sparkignore so agents can't read or change them and Jev never receives their contents.
---

You'll protect files that Spark doesn't already treat as secret. About 2 minutes.

1. Create a file named `.sparkignore` at the root of the repo.
2. Add one pattern per line:

   ```text
   # Lines starting with # are ignored.
   secrets/
   *.sqlite
   config/production.yml
   ```

3. Save it. It applies from the agent's next action.

## Pattern rules

| Pattern      | Matches                                       |
| ------------ | --------------------------------------------- |
| `*`          | Any characters within one folder or file name |
| `**`         | Across folders                                |
| `?`          | One character                                 |
| No `/` in it | That name anywhere in the repo                |
| Has a `/`    | A path from the repo root                     |

Exception lines that start with `!` aren't supported.

## What it does

Matching files are treated exactly like [secret files](protected-paths.md#secret-files):

- Agents can't read or change them, and commands that touch them ask you first.
- They're left out of the **@** file picker.
- Their contents are never sent to Jev when the Map labels areas. Without Jev, nothing is sent for the Map at all.

> **Tip:** A listed file can still show as a dot on the Map, because the Map is built from the repo's file list. Its contents are never read.

**Next:** [The Map](map.md)
