---
title: Runs and pull requests
section: Help
type: troubleshooting
order: 714
summary: Fixes for a run that seems stuck, a run that stopped with the app, an expired card, a blocked step and a failed push.
---

Still stuck? Ask in any chat: "Why did my last run fail?". The agent reads your chats and runs with [Spark's tools](spark-tools.md).

## A run seems stuck

- **You see:** a chat that doesn't move.
- **Why:** it's usually waiting for you, or a long command is running.
- **Fix:** read the line above the message box. **Waiting for you** jumps to the card. Anything else, such as **Running · pnpm test**, is still working.
- **Still stuck:** select **Stop**, then send a new message.

## A run stopped with the app

- **You see:** the **This turn was interrupted** card.
- **Why:** Spark Outpost stopped while the run was working.
- **Fix:** select **Continue from here** to resume the session, or **Start fresh**. Nothing retries by itself.

## A card expired

- **You see:** **Expired** on an approval card.
- **Why:** nobody answered within 30 minutes, so it was declined.
- **Fix:** ask the agent to try again.
- **Still stuck:** [allow the command](answer-approvals.md#let-a-command-run-without-asking) for the project.

## Spark blocked a step

- **You see:** a step that says "Spark's policy blocked", or "Declined: … (Secret files always ask)".
- **Why:** the action crossed a [protected path](protected-paths.md), or a read-only mode was asked to change files.
- **Fix:** in a read-only mode, select **Make the change**. For a protected path, answer the card.
- **Still stuck:** do that step in a [terminal](terminals.md).

## A push or PR failed

- **You see:** an error with the exact `git push` command, or only a **Create PR on GitHub** link.
- **Why:** your git login was refused and no GitHub sign-in or token covers the repo, or GitHub isn't connected.
- **Fix:** open **Settings → Connectors → GitHub** and select **Test**.
- **Still stuck:** run the shown command in a terminal, or create the PR from the link.

## A plan didn't build by itself

- **You see:** **Build this plan?** waiting at **Automatic**.
- **Why:** at **Automatic** a plan waits for you in every agent mode.
- **Fix:** select **Build**, or set the chat to [**Full auto → PR**](spark-autonomy.md).
