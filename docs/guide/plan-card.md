---
title: Plan before building
section: Chats
type: how-to
order: 220
summary: Have the agent plan first with /plan or Plan mode, approve its plan, and open the plan Spark saved for a build.
---

You'll have the agent plan before it changes anything. About 1 minute.

1. Type `/plan` and what you want, or set the chat's mode to **Plan** and ask for the change.
2. Read the agent's plan on its **Approve the plan?** card.
3. Approve it to build, or keep planning.

The card is the agent's own. A mode that never asks, such as **Full access**, approves it at once.

In a **Plan** chat a question is answered as usual. Only `/plan` or a request to build starts a plan.

## The plan line

Spark has no plan card of its own. When your message is a build, Spark saves the plan it already has as the chat's agreed plan and keeps building. Nothing waits.

| Build             | Plan saved             |
| ----------------- | ---------------------- |
| Split into pieces | The Coordinator's list |
| One Builder       | The steps it lists     |
| After `/plan`     | The plan you approved  |

The thread shows one line, such as **Plan saved · 4 pieces**. Select it to open the plan in the **Work** panel. A revised plan is saved as a new version, and the line updates.

> **Tip:** **Save as agreed plan** under a reply makes that reply the chat's plan.

**Next:** [Review, keep or revert changes](review-changes.md)
