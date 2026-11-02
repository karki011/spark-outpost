---
title: Runs and pull requests
section: Help
type: troubleshooting
order: 714
summary: Fixes for a run that seems stuck, a run that stopped with the app, an expired card, a blocked step and a failed push.
---

## A run seems stuck

- **You see:** a chat not moving.
- **Why:** it usually waits for you or runs a long command.
- **Fix:** read the end of the turn: a card waits there, or **Working** runs on. **⌘⇧Y** jumps to a card.
- **Still stuck:** **Stop**, then send a new message.

## A run stopped with the app

- **You see:** the **This turn was interrupted** card.
- **Why:** the app stopped mid-run.
- **Fix:** **Continue from here** resumes the session, or **Start fresh**. Nothing retries itself.

## A card expired

- **You see:** **Expired** on an approval card; the turn says "waited for you".
- **Why:** unanswered for 30 minutes, it was declined.
- **Fix:** **Try again** under the turn.
- **Still stuck:** [allow the command](answer-approvals.md#let-a-command-run-without-asking) for the project.

## Spark blocked a step

- **You see:** "Refused" with the command and why, such as "Refused gh pr create — …", or "Declined: … (This changes .env, a secret file)".
- **Why:** it crossed a [protected path](protected-paths.md), or a read-only mode tried to change files.
- **Fix:** leave the read-only mode, or answer the path's card.
- **Still stuck:** do it in a [terminal](terminals.md).

## A push or PR failed

- **You see:** an error with the exact `git push` command, or only a **Create PR on GitHub** link.
- **Why:** your git login was refused, and no GitHub connection covers the repo.
- **Fix:** **Test** in **Settings → Connectors → GitHub**.
- **Still stuck:** run the shown command in a terminal, or create the PR from the link.

## A change wasn't published

- **You see:** "Not published: …" ending a reply, or no PR at **Full auto → PR**.
- **Why:** the publish step failed or was stopped; a later turn changing no files doesn't retry.
- **Fix:** ask the agent to push and open the PR, or [ship](ship-and-pull-requests.md) it yourself.
