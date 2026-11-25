---
title: Workflows in a chat
section: Chats
type: how-to
order: 231
summary: Read a workflow run from the card above the message box, fix its findings and run one workflow in several chats at once.
---

A workflow run in a chat shows as one line and a card above the message box. About 2 minutes.

## Read the card

1. Select **Show** on the line, or the card's row.
2. Read the findings, Critical and High first; **Show N more** lists the rest.
3. Select **Fix** on a finding to quote it in the message box. Edit and send; nothing sends by itself.
4. When the row says **Needs you**, select **Go to the card** and answer under the line.

Findings are last-step lines starting `[Critical]`, `[High]`, `[Medium]` or `[Low]`.

| The run                    | The card                              |
| -------------------------- | ------------------------------------- |
| Is working or needs you    | Stays, with **Stop**.                 |
| Found something, or failed | Stays until you select ✕.             |
| Finished clean             | Leaves once you send another message. |

The card names what each running step is doing; **Show in chat** opens it. **View** beside **Waiting on N Sparks** opens the card. Before-publish reviews show too.

**Steps** on the line lists each step's reply; **Open run view** shows the whole run. See [Follow a workflow run](workflow-runs.md).

## The chat's agent gets the report

When a run ends, the chat's agent reads the last steps' replies (4,000 characters each) and answers under the line. It isn't your message: the agent follows the chat's mode, and a run not started with `@` never pushes.

## Pick the pull request

Add a pull request's link to your message to run on it; otherwise it takes the chat's newest open one.

## Run in several chats

1. Select **Sparks** in the left bar, then **Workflows**.
2. Select **Run in chats…** on a workflow.
3. Tick the chats, add a message if you like, select **Run in N chats**.

Each chat runs at once in its own folder and branch. One that can't start says why; a second run in a chat waits.

**Next:** [Run a workflow on a schedule](workflow-schedules.md)
