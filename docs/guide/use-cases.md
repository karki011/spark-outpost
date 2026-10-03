---
title: Use cases
section: How Spark works
order: 194
summary: Six short walkthroughs, from a question about the code to a Full auto pull request, showing what Spark does and which cards you see.
---

You'll see how Spark handles six typical requests in the demo project `acme-web`. About 5 minutes.

Each one assumes the defaults, Claude on **Auto** mode, unless it says otherwise.

## Ask a question about the code

- **Prompt:** "Why does the billing webhook retry?"
- **What Spark does:** a Reader reads the code and answers. Nothing changes.
- **Cards:** none.
- **Result:** an answer in the chat. To act on it, ask for the change in your next message.

## Fix a small bug at Automatic

- **Prompt:** "The invoice total shows NaN when a line has no quantity. Fix it."
- **What Spark does:** one Builder fixes it in the chat's worktree. Spark runs your tests itself.
- **Cards:** none, if the tests pass. If they still fail after 2 fix turns, the **Keep these changes?** card asks.
- **Result:** the fix is kept on the chat's branch. Select **Open PR** to ship it, or **Bring changes into** your checkout.

## Build a bigger feature in pieces

- **Prompt:** "Add CSV export: a store for export jobs, an API endpoint and a download button."
- **What Spark does:** plans first, then a Coordinator splits the plan into pieces. Builders work side by side, the full checks run once and a Critic reviews. See [Big work in pieces](pieces.md).
- **Cards:** **Build this plan?**, which builds by itself after the answer wait unless you edit or stop it.
- **Result at Full auto → PR:** if pieces were built in their own copies, Spark asks **One PR or separate PRs?**, then opens the PR.

## Make a risky or destructive change

- **Prompt:** "Drop the legacy_invoices table and migrate old rows."
- **What Spark does:** always plans first. The Builder runs on the top model in a worktree copy, and a Critic reviews before anything lands.
- **Cards:** **Build this plan?** marked "this would change data permanently". It waits for you at every level, even Full auto.
- **Result:** after you approve the plan, the change follows the usual keep and ship steps.

## Let Full auto open a PR and handle review

- **Prompt:** "Add a dark mode toggle to the dashboard", with the chat at **Full auto → PR**.
- **What Spark does:** builds, checks, keeps and opens a PR by itself, a draft if checks still fail. When a reviewer comments, Spark fixes it, pushes and replies on the thread. See [Follow up on pull requests](pr-follow-up.md).
- **Cards:** none, unless something is protected, destructive or over budget.
- **Result:** a PR ready for you to review and merge. Spark never merges and stops after 3 follow-up rounds.

## Keep working in a long chat

- **Prompt:** your 40th message in a chat about the billing rewrite.
- **What Spark does:** when the agent's context passes 80%, Spark compacts it to a summary before your message and notes it in the work log.
- **Cards:** none, unless you turned automatic compaction off. Then **This chat is almost full** offers **Compact now**, **Start a fresh chat with a summary** or **Keep going**.
- **Result:** a **Compacted** divider with **View summary**. The full transcript stays in the chat. See [Long chats and compaction](compaction.md).

> **Tip:** Want to see every step? Pick the agent's **Manual** mode on your first few chats to approve each edit and command, then switch to **Auto**.

**Next:** [Chats, modes and autonomy](chats-and-modes.md)
