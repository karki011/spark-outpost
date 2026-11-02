---
title: How Spark works
section: Understand Spark
type: concept
order: 510
summary: What Spark adds around Claude, Codex and Z.ai, and the path a message takes from the message box to a pull request.
---

One chat is one agent session. Your message goes to the agent as typed; Spark adds approvals, worktrees, auditing and publishing.

## What happens to a message

| Step       | What happens                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Place   | In a mode that can change files, the chat gets its own [worktree](where-spark-works.md) and branch, or a private folder without a project. |
| 2. Plan    | Only when you ask: `/plan` or **Plan** mode has the agent [plan first](plan-card.md).                                                      |
| 3. Work    | The agent answers or changes code. Every action passes the [approval gate](approvals.md) and the audit.                                    |
| 4. Keep    | Changed files are kept, with a **Changes kept** record you can [revert](review-changes.md).                                                |
| 5. Publish | You [ship](ship-and-pull-requests.md), or the agent pushes and opens the PR. Spark then [handles PR feedback](pr-follow-up.md).            |

## How work is split

The lead delegates implementation slices to available provider sub-agents, choosing roles, count and slices per worker.

| Responsibility     | Work                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| Lead               | Scope slices, coordinate dependencies, integrate and report results. |
| Builder            | Implement one or several assigned slices.                            |
| Verifier           | Test the exact changes; report checks and gaps.                      |
| Reviewer           | Independently inspect the diff for defects.                          |
| Explorer, optional | Investigate uncertainty without editing.                             |

Assignments carry scope, interfaces, dependencies and done criteria. Workers return files, checks and blockers. Plans and results stay in session tools or transcripts.

Questions, planning and assigned slices need no recursive delegation. Across repositories or chats, use an [outpost](when-to-use-an-outpost.md).

Codex keeps your delegation settings. Without available workers, the agent explains and asks. Reports identify workers, checks and remaining limits.
