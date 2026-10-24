---
title: What's new
section: Help
type: whats-new
order: 720
summary: Recent changes you can see in the app, newest first, and what to do about each.
---

Changes since the last release, newest first. For earlier ones, open **Release notes** in **Settings → Updates**.

## October 2026

| What changed                                                                                                                                       | What to do                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Spark's rules live in `settings.json`, empty by default: your agent's mode decides, so **Bypass permissions** can force push or edit secret files. | Choose **Use recommended rules** in [Spark rules](protected-paths.md#spark-rules). |
| **Settings → Spark rules** lists every rule, merging included; agents ask on a card to change them. Printing the GitHub token is always refused.   | Set them in [Spark rules](protected-paths.md#spark-rules).                         |
| A refused step says what and why.                                                                                                                  | Nothing.                                                                           |
| `gh -R owner/repo pr checks 5` counts as a read.                                                                                                   | Nothing.                                                                           |
| **Needs sign-in** clears once a test passes.                                                                                                       | Nothing.                                                                           |
| **Good result** and **Bad result** show only on the pull request's turn.                                                                           | Rate that turn if you like.                                                        |
