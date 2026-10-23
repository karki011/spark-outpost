---
title: Plan before building
section: Chats
type: how-to
order: 220
summary: Have the agent plan first with /plan or Plan mode, approve its plan, and open the approved plan later.
---

The agent plans before changing anything. About 1 minute.

1. Type `/plan` and what you want, or set the chat's mode to **Plan** and ask for the change.
2. Read the agent's plan on its **Approve the plan?** card.
3. Approve it to build, or keep planning.

The card is the agent's own. A mode that never asks, such as **Full access**, approves it at once.

While planning in **Auto** or **Bypass permissions**, commands that change no files run without a card; ones that change files still ask.

`/plan` plans for one turn. In a **Plan** chat every message runs in the agent's Plan mode, so nothing changes until you approve. Such a chat gets a worktree even for a question.

## The plan line

Spark has no plan card and saves no plan of its own. Without `/plan` or **Plan** mode the agent builds at once, and the steps it lists show under [**To-do**](follow-a-turn.md#see-whats-happening).

The plan you approve becomes the chat's agreed plan. The thread shows **Plan saved**; select it to open the plan in **Work**. A revised plan you approve is saved as a new version.

Codex's plan setting stops no edit, so `/plan` runs a Codex turn in **Read-only**: it replies with a plan, changes nothing and shows no line; **Work** lists it as **Proposed plan**. Your next message builds.

Older chats keep lines such as **Plan saved · 4 pieces**.

**Next:** [Review, keep or revert changes](review-changes.md)
