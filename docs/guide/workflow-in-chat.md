---
title: Workflows in a chat
section: Chats
type: how-to
order: 231
summary: Read a workflow run from the card above the message box, fix its findings and run one workflow in several chats at once.
---

A workflow run in a chat shows as one line in the conversation. The run sits in a card above the message box, beside the pull request card. About 2 minutes.

## Read the card

1. Select **Show** on the line, or the card's row, to open it.
2. Read the findings, Critical and High first. **Show N more** lists the rest.
3. Select **Fix** on a finding to quote it in the message box. Edit it and send; nothing sends by itself.
4. When the row says **Needs you**, select **Go to the card** and answer it under the line.

Findings are the lines in the last steps' replies that start with `[Critical]`, `[High]`, `[Medium]` or `[Low]`.

| The run                    | The card                              |
| -------------------------- | ------------------------------------- |
| Is working or needs you    | Stays, with **Stop**.                 |
| Found something, or failed | Stays until you select ✕.             |
| Finished clean             | Leaves once you send another message. |

**Steps** on the line shows what each step did; **Open run view** shows the whole run. See [Follow a workflow run](workflow-runs.md).

## Pick the pull request

Add a pull request's link to your message to run on it. Without one, the run takes the chat's newest open pull request and names it. Steps read another branch's pull request from GitHub.

## Run in several chats

1. Select **Sparks** in the left bar, then **Workflows**.
2. Select **Run in chats…** on a workflow.
3. Tick the chats, add a message if you like, and select **Run in N chats**.

Each chat gets its own run, in its own folder and branch, all at once. A chat that can't start says why under its name; the others still run. A second run in the same chat waits for the first.

**Next:** [Run a workflow on a schedule](workflow-schedules.md)
