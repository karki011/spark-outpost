---
title: Answer an approval card
section: Chats
type: how-to
order: 218
summary: Allow or deny a command or file change an agent asks about, hold to confirm the risky ones, and let trusted commands run without asking.
---

You'll answer an agent that's waiting for your permission. About 1 minute.

1. Select **Waiting for you** above the message box, or press **⌘⇧Y**, to jump to the card.
2. Read the command or the diff, where it runs, and why it asks.

   ![An approval card asking to run a command](images/approvals-command-light.png)

3. Select a button. The labels come from the agent, so they vary a little.

| Button                           | Does                                                     |
| -------------------------------- | -------------------------------------------------------- |
| **Allow**                        | Runs it this once.                                       |
| **Always allow**                 | Allows this kind of request for the rest of this run.    |
| **Always allow in this project** | Adds the command to the project's list.                  |
| **Deny**                         | Doesn't run it. The agent is told and tries another way. |

A card nobody answers within 30 minutes is declined and says **Expired**.

## Hold to confirm

**Change git hooks or config?** and **Force push?** have no ordinary allow button.

1. Read the whole change.
2. Press and hold **Hold to allow once** or **Hold to force push** for 1.5 seconds, with the mouse or **Space**.
3. Let go early to cancel.

![The Change git hooks or config card with Hold to allow once](images/approvals-hold-light.png)

## Agent instruction files

**Change agent instructions?** appears for files such as `AGENTS.md`. Pick **Allow once**, **Allow for this chat** or **Deny**.

## Let a command run without asking

1. Select the project name above the message box.
2. Open **Commands that run without asking**.
3. Type a command and select **Add**. Select **×** to remove one.

![The project menu with Commands that run without asking open](images/approvals-allowlist-light.png)

A listed command covers longer forms too: `pnpm test` allows `pnpm test -- api`. Commands that touch [protected paths](protected-paths.md), push or send data out always ask.

## Where waiting cards show

Cards wait in the chat, on **Home** under **What needs you today**, in the chat list as **Asking permission**, and on [Spark Island](desktop-companion.md#answer-a-card).

To see what was allowed, open the chat's **…** menu and select **Audit this chat**.

**Next:** [Plan before building](plan-card.md)
