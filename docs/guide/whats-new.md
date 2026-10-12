---
title: What's new
section: Help
type: whats-new
order: 720
summary: Recent changes you can see in the app, newest first, and what to do about each.
---

What changed recently in Spark, newest first.

## October 2026

| What changed                                                                                                                                                                                                 | What to do                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| A Terminal session starts from the message box: **Chat** or **Terminal**, folder, agent, permissions. **Focus terminal** (**⌘⇧F**) fills the window. **Hide view** is gone; **Stop session** is under **⋯**. | See [terminals](terminals.md).                  |
| **Cost** shows cache writes and sub-agents as their own token parts, so the parts add up. Codex sub-agents show their model and an estimated cost.                                                           | Nothing to do.                                  |
| A sub-agent's row opens its steps, changed files, commands, report and usage. A turn's tokens include its sub-agents; **Cost** lists them. **Stop** ends their commands too.                                 | See [how Spark works](how-spark-works.md).      |
| Claude and Z.ai sub-agents always run in the background. While the agent only waits on them, **Enter** sends your message now; that turn is never stopped to deliver it.                                     | See [follow a turn](follow-a-turn.md).          |
| A sub-agent's permission card names it. Its row opens the whole task.                                                                                                                                        | See [approval cards](answer-approvals.md).      |
| A turn lists the agent's sub-agents with task, step and state. The chat says **Waiting on 2 sub-agents** while the agent only waits for them.                                                                | See [how Spark works](how-spark-works.md).      |
| While follow-up is on, the agent may comment and reply on its own pull request, under its mode. Outpost answers show **Committed** and **Pushed**.                                                           | See [PR feedback](pr-follow-up.md).             |
| One chat is one agent session: your message goes to the agent as typed. Crews, pieces, the Critic and Spark's own checks are gone; the agent uses its own sub-agents.                                        | See [how Spark works](how-spark-works.md).      |
| Removed settings: **Use Spark workflow**, **Check changes with Jev**, **When checks still fail in Full auto**, and a project's **Builders at once** and **Checks after a change**.                           | Nothing to do.                                  |
| Spark saves a plan only when you approve the agent's; the line reads **Plan saved**. Every message in a **Plan** chat plans first. Codex `/plan` is read-only: a **Proposed plan**.                          | See [plans](plan-card.md).                      |
| Publishing is one request to the agent after its reply; Spark's result line leads. A PR is a draft only if you ask or Settings says so. An unasked push is refused. "Push, no PR" only pushes.               | See [Ship a change](ship-and-pull-requests.md). |
| **Changes kept** lists files and lines only. **Keep these changes?**, **Worth a look** and **Needs you:** endings are gone. A folder without git lists the agent's edits.                                    | See [changes](review-changes.md).               |
| Jev works only on the Map, PR feedback and Spark Island. **Auto** means the provider's default model. The chat names the model that ran.                                                                     | See [Jev](jev.md).                              |
