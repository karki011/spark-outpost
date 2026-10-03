---
title: Steer big work in pieces
section: Crew and pieces
type: how-to
order: 412
summary: Choose how many Builders run at once, steer pieces while they run, and pick one pull request or several.
---

You'll control how Spark builds work that's too big for one Builder. About 2 minutes.

After you agree a plan, Spark may split it into pieces, one Builder each. See [How pieces work](how-pieces-work.md).

## Choose how many Builders run at once

1. Open **Settings → Projects** and find the project.
2. Under **Builders at once**, pick **1 at a time, in order**, **Up to 2 at once** or **Up to 3 at once** (the default).

More at once finishes sooner and spends faster.

## Steer the pieces while they run

1. While pieces run, find **Steer to** above the message box.
2. Pick who gets your message:

   | Pick                          | Goes to                                                 |
   | ----------------------------- | ------------------------------------------------------- |
   | **Auto**                      | Whoever your words name, such as a piece key or Builder |
   | **All pieces**                | Every piece still open                                  |
   | A piece, such as **P2 · API** | That piece's Builder                                    |
   | **Coordinator**               | Read when the pieces are joined                         |

3. Send. The line above the box says when it arrives, such as "Queued for Rivet: … (next turn)".

Write "skip P3" to skip a piece, or "use Codex for P2" to move one.

## One PR or separate PRs

At **Full auto → PR**, when two or more pieces were built in their own copies, Spark asks **One PR or separate PRs?**.

1. Pick **One PR** or **Separate PRs**.
2. To skip the card next time, pick **Always one PR here** or **Always separate PRs here**.

If you don't answer, Spark picks **One PR** after the time in **If you don't answer a question**. With that setting **Off**, the card waits.

> **Tip:** On a busy repo, set **Builders at once** to **1 at a time, in order**. Spark still splits the work but builds one piece at a time.

**Next:** [Ship a change](ship-and-pull-requests.md)
