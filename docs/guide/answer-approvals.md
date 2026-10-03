---
title: Answer an approval card
section: Chats
type: how-to
order: 222
summary: Allow or deny a command or file change an agent asks about, hold to confirm the risky ones, and find cards that wait for you.
---

You'll answer an agent that's waiting for your permission. About 1 minute.

1. Find the card. The line above the message box says **Waiting for you**; select it or press **⌘⇧Y** to jump to the card.
2. Read the command or the diff, where it runs, and why it asks. Select **Show all** for a long command.

   ![An approval card asking to run a command](images/approvals-command-light.png)

3. Select a button. The labels come from the agent, so they vary a little.

| Button                           | Does                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| **Allow**                        | Runs it this once.                                           |
| **Always allow**                 | Allows this kind of request for the rest of this run.        |
| **Always allow in this project** | Adds the command to the [project's list](allow-commands.md). |
| **Deny**                         | Doesn't run it. The agent is told and tries another way.     |

The card then shows your answer, such as "Chose: Allow."

## Hold to confirm

**Change git hooks or config?** and **Force push?** have no ordinary allow button.

1. Read the whole change.
2. Press and hold **Hold to allow once** or **Hold to force push** for 1.5 seconds, with the mouse or **Space**.
3. Let go early to cancel.

![The Change git hooks or config card with Hold to allow once](images/approvals-hold-light.png)

## Agent instruction files

**Change agent instructions?** appears for files such as `AGENTS.md`. Pick **Allow once**, **Allow for this chat** or **Deny**.

## Where waiting cards show

- In the chat, and on **Home** under **What needs you today**.
- In the chat list (**Asking permission**) and as a count on **Chats** in the rail.
- In the **Work** panel under **Waiting for you**.
- On [Spark Island](companion-approvals.md) in the Mac app.

A card nobody answers within 30 minutes is declined and says **Expired**.

## See what was allowed

Each turn's steps record every request, such as "Allowed pnpm test (you allowed it)". For the full record, open the chat's **…** menu and select **Audit this chat**.

**Next:** [Answer a plan](plan-card.md)
