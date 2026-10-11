---
title: What's new
section: Help
type: whats-new
order: 720
summary: Recent changes you can see in the app, newest first, and what to do about each.
---

What changed recently in Spark, newest first.

## October 2026

| What changed                                                                                                                                                                       | What to do                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| While follow-up is on, the agent may comment and reply on its own pull request, under its mode.                                                                                    | See [PR feedback](pr-follow-up.md).             |
| One chat is one agent session: your message goes to the agent as typed. Crews, pieces, the Critic and Spark's own checks are gone; the agent uses its own sub-agents.              | See [how Spark works](how-spark-works.md).      |
| Removed settings: **Use Spark workflow**, **Check changes with Jev**, **When checks still fail in Full auto**, and a project's **Builders at once** and **Checks after a change**. | Nothing to do.                                  |
| Spark saves a plan only when you approve the agent's; the line reads **Plan saved**. Every message in a **Plan** chat plans first.                                                 | See [plans](plan-card.md).                      |
| Publishing is one request to the agent after its reply. A pull request is a draft only when you ask or Settings says so. An unasked push is refused. "Push, no PR" only pushes.    | See [Ship a change](ship-and-pull-requests.md). |
| **Changes kept** lists files and lines only. **Keep these changes?**, **Worth a look** and **Needs you:** endings are gone.                                                        | See [changes](review-changes.md).               |
| Jev works only on the Map, PR feedback and Spark Island. **Auto** means the provider's default model.                                                                              | See [Jev](jev.md).                              |
| Older chats keep their crew, costs, cards and plans, read-only, without piece boards or **Message**.                                                                               | Nothing to do.                                  |
| **Agent TV** opens for every turn and shows the chat's agent and Sparks. **Analytics** has **Overview** and **Spend**; `spark_analytics` has no harness report.                    | See [follow a turn](follow-a-turn.md).          |
| **Settings → Models** groups models as **Everyday and complex work** and **Other models**. A project with no commits is worked on in its folder.                                   | See [models](providers-and-models.md).          |
| **Phone** is now **Remote control**. Paired devices stay paired.                                                                                                                   | See [remote control](use-your-phone.md).        |
| Agents can keep a command running after the turn: **Agent terminal**, with **Stop**.                                                                                               | See [Spark tools](spark-tools.md).              |
| **Open in terminal** on a reply's command mirrors it in a read-only tab.                                                                                                           | See [Open a terminal](terminals.md).            |
| No other-branch pushes or remote changes. Claude asks before changing instruction files, git hooks and config, worktrees too.                                                      | See [protected paths](protected-paths.md).      |
