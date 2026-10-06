---
title: Watch and steer the crew
section: Chats
type: how-to
order: 230
summary: Watch a chat's agents in Agent TV, message one of them, steer the pieces of big work, and pick one pull request or several.
---

You'll watch the agents on a request, message one, and steer big work. About 2 minutes.

## Watch in Agent TV

1. Select **Agent TV** in the chat header, once the first reply starts.
2. Pick **Stage** to see the agents as blobs, or **List** for each agent's model, time and cost.
3. Select an agent, then **Go to** to jump to its work. Press **Esc** to close.

Agent TV keeps following its chat while you open another.

## Message a crew member

1. Select **Message** on the agent's row in **Agent TV**, in the **Crew** tab of the **Work** panel, or in the chat.
2. Type your message and select **Send to** _name_.

The chat shows it; the agent reads it next. A finished Builder shows **Continue** _name_ and resumes in a new turn.

## Steer the pieces

Spark may split a big plan into [pieces](spark-crew.md#pieces), one Builder each.

1. While pieces run, find **Steer to** above the message box.
2. Pick **Auto**, **All pieces**, one piece such as **P2 · API**, or **Coordinator**.
3. Send. Write "skip P3" to skip a piece, or "use Codex for P2" to move one.

**Auto** sends to whoever your words name. **Enter** and **⌘Enter** both steer.

## Choose how many Builders run at once

1. Open **Settings → Projects** and select the project.
2. Under **Builders at once**, pick **1 at a time, in order**, **Up to 2 at once** or **Up to 3 at once** (the default).

## One PR or separate PRs

At **Full auto → PR**, Spark asks **One PR or separate PRs?** when pieces were built in their own copies.

1. Pick **One PR** or **Separate PRs**.
2. To skip the card next time, pick **Always one PR here** or **Always separate PRs here**.

Unanswered, Spark picks **One PR** after the **Wait before going with best guesses** time.

**Next:** [Choose where a chat works](where-spark-works.md)
