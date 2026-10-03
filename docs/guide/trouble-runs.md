---
title: Runs and pull requests
section: Troubleshooting
type: troubleshooting
order: 956
summary: Fixes for a run that seems stuck, a run that stopped with the app, an expired card, a blocked step and a failed push.
---

## A run seems stuck

- **You see:** a chat that doesn't move.
- **Why:** it's usually waiting for you, or a long command is running.
- **Fix:** read the line above the message box. **Waiting for you** means a card waits; select the line to jump to it. Anything else, such as **Running · pnpm test**, means it's still working.
- **Still stuck:** select **Stop**, then send a new message. To ask what it's doing without interrupting, open the **Work** panel or use **Ask for update** on Spark Island.

## A run stopped with the app

- **You see:** a run that says its outcome is unknown.
- **Why:** Spark Outpost stopped while the run was working.
- **Fix:** send the request again. Nothing is retried by itself.
- **Still stuck:** open the **Work** panel to see what the run changed before you resend.

## A card expired

- **You see:** **Expired** on an approval card.
- **Why:** nobody answered within 30 minutes, so the request was declined.
- **Fix:** ask the agent to try again.
- **Still stuck:** [allow the command](allow-commands.md) for the project, or pick a [mode](agent-mode.md) that asks less.

## Spark blocked a step

- **You see:** a step that says "Spark's policy blocked", or "Declined: … (Secret files always ask)".
- **Why:** the action crossed a [protected path](protected-paths.md), or a read-only mode was asked to change files.
- **Fix:** in a read-only mode, select **Make the change**. For a protected path, answer the card when it appears.
- **Still stuck:** do that step yourself in a [terminal](terminals.md).

## A push or PR failed

- **You see:** an error with the exact `git push` command, or only a **Create PR on GitHub** link.
- **Why:** your git login was refused and no GitHub token is saved, or GitHub isn't connected.
- **Fix:** open **Settings → Connectors → GitHub** and select **Test**. It checks each project's remote and sign-in.
- **Still stuck:** run the shown command in a terminal, or open the link and create the PR yourself.

## A plan didn't build by itself

- **You see:** **Build this plan?** waiting at **Automatic**.
- **Why:** at **Automatic** a plan always waits for you, in every agent mode.
- **Fix:** select **Build**.
- **Still stuck:** to build plans without waiting, set the chat to [**Full auto → PR**](spark-autonomy.md).
