---
title: Plan before building
section: Chats
type: how-to
order: 220
summary: Have the agent plan first with /plan or Plan mode, approve its plan, and open the approved plan later.
---

You'll have the agent plan before it changes anything. About 1 minute.

1. Type `/plan` and what you want, or set the chat's mode to **Plan** and ask for the change.
2. Read the agent's plan on its **Approve the plan?** card.
3. Approve it to build, or keep planning.

The card is the agent's own. A mode that never asks, such as **Full access**, approves it at once.

While the agent plans, a chat set to **Auto** or **Bypass permissions** runs commands that change no files without a card. A command that changes files still asks.

`/plan` plans for one turn. In a **Plan** chat every message runs in the agent's Plan mode, so nothing changes until you approve its plan. Such a chat gets a worktree even for a question.

## The plan line

Spark has no plan card of its own and saves no plan of its own. Without `/plan` or **Plan** mode the agent builds at once, and the steps it lists show under **Tasks**.

The plan you approve becomes the chat's agreed plan. The thread shows one line, **Plan saved**. Select it to open the plan in the **Work** panel. A revised plan you approve is saved as a new version.

Codex's plan setting stops no edit, so `/plan` runs a Codex turn in **Read-only**: it replies with a plan, changes nothing and shows no line. Send your next message to build.

Older chats keep lines such as **Plan saved · 4 pieces**.

**Next:** [Review, keep or revert changes](review-changes.md)
