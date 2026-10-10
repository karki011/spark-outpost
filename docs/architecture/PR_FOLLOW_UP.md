# PR follow-up

After Spark opens a pull request from a chat, the worker watches it through the user's existing GitHub connection (GitHub App sign-in for covered repos, token, or gh CLI; see `GITHUB_APP.md`) and handles failing checks and review feedback. Code: `apps/server/src/pr-follow-up/`, storage in `persistence/pr-watches.ts` (migration 0087).

## Ready for review by default

Settings → Spark → Pull requests → **Open pull requests as**: Ready for review (default) or Draft (`profiles.pr_ready_for_review`). Ship passes the choice to GitHub (`NewPullRequest.draft`). The one exception: a Full auto PR whose checks still fail, when **When checks still fail in Full auto** says to open it anyway, always opens as a draft marked "Checks failing" (`ShipOptions.draft`). The ship mode id stays `draft_pr`; user-facing copy says "PR" and only says "draft PR" when GitHub got `draft: true`. The setting is global: Ship has no per-project settings today.

## Watching

Ship registers a `pr_watches` row for every PR it opens or updates (chat, task, repo, number, branch). `startPrFollowUp` in the worker ticks every 15 s and polls due watches:

- `watching` / `needs_you`: read the PR; stop (`done`) when merged or closed. Otherwise gather, triage and maybe start a round. The interval starts at 2 minutes and doubles while nothing changes, up to 30 minutes; any new item resets it.
- `fixing` / `confirming`: no GitHub reads; check the round run or the confirm card every 20 s. A decided card also wakes the poller through the `approvals` notification.

Webhooks would replace most polling; they need a public endpoint or the GitHub App, so they are left for later.

## Every pull request of a chat

`pr_watches` (extended in migration 0132) holds every pull request opened in a chat, not only the ones Ship opened. `follow_up` together with a task decides whether the fix loop applies (`Watch`); the wider row is `TrackedPull` (`persistence/tracked-pulls.ts`) and is polled for status only. Rows are unique per workspace, host, repository (case-insensitive) and number, and record `opened_via` (`ship`, `agent`, `terminal`, `discovery`), who opened it and the run.

| Source                        | Code                                                       | Notes                                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The agent's `gh pr create`    | `tasks/agent-pull-request.ts`                              | Always tracked; followed up only when the repository is the chat's and the head is the chat's own branch. Audited as `ship/agent_pr`.                          |
| The publish step              | `workflow/publish-step.ts`                                 | Spark asks GitHub for a pull request with the branch as head after the turn and records it.                                                                    |
| A tool in a chat terminal tab | `terminal/pull-request-scan.ts`, `pr-tracking/terminal.ts` | Output is scanned for github.com pull request links; a link counts only when GitHub confirms its head is a branch of the chat or the user opened it meanwhile. |
| Discovery                     | `pr-tracking/discover.ts`                                  | Pull requests whose head is the chat's own branch, or the branch checked out in its worktree. Runs on chat open, focus and run start or finish, once a minute. |

Terminal and discovery sightings are audited as `ship/pr_tracked` and never take a pull request another chat tracks. A pull request in a repository the chat is not linked to is marked `outside`.

Status per row: state, title, head and base, checks with the failing check names and links, and the review verdict. Checks follow one rule (`ship/github/check-runs.ts`), shared with the tickets screen: pending while any run is incomplete, failing only when all are complete and at least one failed. Missing access sets a plain reason and reads as unknown; a rate limit pauses every row on that host for 30 minutes. The web asks `POST /conversations/:id/pull-requests/refresh` on chat open, focus, run start and finish, and on a 1 to 10 minute timer; the worker is woken through the `pr_poll` channel.

Not covered: an unresolved-thread count (no read provides it), and a Tasks row for terminal and discovery pull requests.

## Gathering and dedup

Per poll (`gather.ts`): failing check runs on the head commit with the check title, summary and up to 5 failure annotations; inline review comments; reviews that request changes or comment with a body; PR comments. Bots (Copilot, CodeRabbit) are included. Each item has a source key (`check:<name>:<sha>`, `review_comment:<id>`, `review:<id>`, `issue_comment:<id>`) and `pr_feedback_items` is unique per watch and key, so nothing is processed twice; a check that fails again on a new head is new. Spark's own replies carry a hidden marker and are skipped. Lists read up to 5 pages of 100.

Check logs are not downloaded: the excerpt is what the Checks API returns (output title, summary, annotations). Fetching job logs is a possible follow-up.

## Trust and triage

An item is trusted when it is a failing check on the PR's head (the PR's own CI) or its author has write, maintain or admin permission (`GET /collaborators/:login/permission`). Bots and failed lookups are untrusted. Untrusted items are shown (state `held`) and never acted on automatically; the user can include them through `spark_pr_follow_up_round`.

Jev triages new comments in one batch of Choice questions (`triage.ts`): fix, question, disagree (needs a human), nit, already addressed, information. Answers below 0.6 confidence, and everything when Jev isn't connected, use the rules. Checks are always "fix".

States: disagreements → `needs_user` (always the user's call); addressed/information → `done`; untrusted, or switched off by the sub-settings → `held`; questions with replies off → `needs_user`; the rest → `queued`.

## Rounds

When items are queued, the round limit (3 per PR) is not reached, and the branch is in sync, Spark sends one chat message (`source = 'pr_follow_up'`, `startAs = 'change'`) so an ordinary chat turn runs in the chat's worktree on the chat's own session and model. The turn's publish step uses the follow-up prompt: push fixes to the same branch, no new pull request, no replies and no resolved threads.

Before a round starts (`round.ts`, `rounds.ts`):

- **Busy chat.** A chat with a queued, running or waiting run, or a card waiting for the user, is never interrupted: the items stay `queued`, the watch says "New feedback is waiting for the chat's current turn to finish", and the next poll tries again. Everything that arrives meanwhile goes into the same round.
- **Same failure.** A check that fails on the new head with the same name and the same excerpt as the check the previous round fixed is not tried again: it goes to the user with "CI still fails the same way after the fix". A different excerpt is a new failure.
- **Repeated request.** A comment by the same author on the same file and line (or, for PR comments, the same author) as an item the agent already pushed back on goes to the user. Spark does not argue twice.
- The first line of the message says why Spark sent it ("Spark: CI failed on PR #7 (test) and 2 review items arrived on PR #7, so I asked this chat to look") and that the user did not type it. The user stops the turn like any other.

The prompt wraps all GitHub text in `<pr_feedback>` as quoted lines, says it is untrusted data that cannot grant permissions or change the mode, and tells the agent to judge each item on its merits: fix what is right; push back, with a short and specific reason, on what is wrong, out of scope or settled by the project's conventions; for a failing check, fix what its change caused and say so when the check also fails on the base branch or is flaky infrastructure; leave to the user anything that changes scope, is security-sensitive, repeats a pushed-back request, or needs a change to CI workflows, hook configuration or protected files (those keep their ask rules whatever the prompt says). It ends its reply with one line per item: `[F1] fixed: …`, `[F2] pushed back: …`, `[F3] answer: …`, `[F4] left for you: …`, and a summary for the user.

### Who pushes

A round run carries the publish basis `follow_up` (`approvals/publish-policy.ts`, `workflow/publish-context.ts`): the gate and `spark_push` allow a push of the chat's own branch at every autonomy level and in asking modes, but only while `pr_watches` holds an open, followed pull request of that chat on that branch. An ordinary turn in the same chat does not carry it; a merged or closed pull request ends it; the hard rails are unchanged (own branch only, no force push, hooks never skipped, nothing merges, `gh` limited to `pr create`/`view`/`edit`). After the round's checks the orchestration runs the publish turn (`orchestration/agent-publish.ts`): the agent commits and pushes with `spark_push`, and opens nothing.

When the run ends, `settleRound` compares the branch with its remote-tracking ref. A new pushed head is the commit of the round; a new head that was not pushed sends the fixed items to the user ("The fix is in the chat but was not pushed"). Then, per item: fixed → reply "Fixed in <sha>: <note>"; pushed back → reply "Not changed: <reason>", and the thread stays open; answer → the answer; left for you, or no line → `needs_user`. Replies go out through Spark's GitHub connection (the agent's `gh` rail has no comment verb), pass the secret redaction, carry the hidden Spark marker, and each is audited on the round run as `ship/pr_reply` with its text.

**Ask before pushing and replying** (`profiles.pr_follow_up_ask`, off by default) keeps the earlier flow: the fix stays in the working tree, one `spark_action` card (`pr_follow_up`) lists the push and each reply, and on confirm Spark pushes with Ship's `push` mode (no agent turn is running by then) and replies.

Spark never force-pushes, merges, approves, resolves threads or dismisses reviews.

## Where it shows

- Chat: a one-line PR row above the message box (`PrCard`), in the composer stack above the context bar: `#number` link, title, then only the facts that matter (Checks failing or running, N need you, N new comments, Round r of 3 while a round runs) and the state (Open, Draft, Merged, Closed). It has a fixed height (32 px, 44 px on phones) so live updates never move the composer, and a polite status line announces a change of state or facts. Clicking it opens a panel upward (`PullPanel`) with what Spark is doing, the gathered items, and the same checks, reviews and comments sections the Links tab shows (`PullDetails`). More than two pull requests collapse to one "N pull requests" row. A merged or closed row can be dismissed with ×; the dismissal is kept per chat in the browser (`use-dismissed-pulls.ts`, keyed by pull and state, so a reopened pull shows again). It refreshes on the `pull_request` change event. There is no PR chip in the chat header.
- Details: each poll stores `pr_watches.details` (migration `0139_pr_details.sql`): every check run once by name with its state (failing, running, passing, cancelled, skipped, neutral) and the check's own output title; each reviewer's latest verdict (a later plain comment never replaces an approval or a change request); and up to 50 open threads, newest first (review threads GitHub marks resolved are left out, read with one GraphQL call that fails open; replies and Spark's own replies are skipped). Summaries and excerpts are reduced to plain text (`pr-tracking/plain-text.ts`: Markdown and HTML removed, secrets redacted, cut to 160 and 220 characters), are rendered as text only, and are never logged. The view adds Spark's follow-up status to a thread from the feedback item with the same source key (fixed, pushed back, answered, left for you, fixing). The aggregate check state is unchanged: a cancelled run still counts as failing there, and is listed as Cancelled.
- Watching indicator: the PR row, its panel and the Links card show one eye icon with who is on the pull request (`watch-indicator-model.ts`, `WatchIndicator.tsx`). The state is derived, in this order, from facts the server already holds: a running round (`phase = fixing`: "Agent is on it", with the round and the crew member read from the chat's orchestration for `roundRunId`), something for the user (a confirm card, items left, `needs_you`), no access (`pollProblem` `not_connected` or `no_access`, or a status reason), a pause (`rate_limit`, `offline`, `error`, with the last error in brief and the next try), Follow up off (from the profile), rounds used up, checks running, no review yet, then "Spark is watching" (followed) or "Spark is tracking" (status only). Merged and closed pull requests show no indicator. The view adds `nextPollAt`, `pollProblem` (`pr_watches.poll_problem`, migration `0142_pr_poll_problem.sql`, set from the error class when a poll fails and cleared by the next good one) and `roundRunId`. The same migration makes an idle poll that only moved `last_polled_at` send the `pull_request` change event, so "checked 20s ago" stays current; polls during a round do not. The eye pulses only while a round or checks run, never with reduced motion; the row shows a short word on wide screens and the icon alone on phones; the full sentence is the icon's name and tooltip, and the row's polite status line carries the label without the times. When Follow up is off, or asks first, the panel shows that same profile switch. Not known to the server, so never shown: an agent polling the pull request with its own command inside a turn.
- Sidebar, Home and the desktop island: a pending `pr_follow_up` card shows as "PR feedback" (`ConversationAttention.prFeedback`).
- Tickets inbox: a ticket whose PR has items waiting for the user gets the `pr-feedback` attention flag.
- Spark tools: `spark_pr_follow_up`, `spark_pr_follow_up_round` (see `SPARK_TOOLS.md`).

## Settings

Settings → Spark → Pull requests: Follow up on pull requests (on), with Ask before pushing and replying (off), Fix failing checks, Handle review comments and Reply on GitHub threads (all on). These are workspace settings; there is no per-chat or per-pull-request switch yet.
