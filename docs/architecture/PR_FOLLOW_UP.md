# PR follow-up

After Spark opens a pull request from a chat, the worker watches it through the user's existing GitHub connection (GitHub App sign-in for covered repos, token, or gh CLI; see `GITHUB_APP.md`) and handles failing checks and review feedback. Code: `apps/server/src/pr-follow-up/`, storage in `persistence/pr-watches.ts` (migration 0087).

## Ready for review by default

Settings → Spark → Pull requests → **Open pull requests as**: Ready for review (default) or Draft (`profiles.pr_ready_for_review`). Ship passes the choice to GitHub (`NewPullRequest.draft`). The one exception: a Full auto PR whose checks still fail, when **When checks still fail in Full auto** says to open it anyway, always opens as a draft marked "Checks failing" (`ShipOptions.draft`). The ship mode id stays `draft_pr`; user-facing copy says "PR" and only says "draft PR" when GitHub got `draft: true`. The setting is global: Ship has no per-project settings today.

## Watching

Ship registers a `pr_watches` row for every PR it opens or updates (chat, task, repo, number, branch). `startPrFollowUp` in the worker ticks every 15 s and polls due watches:

- `watching` / `needs_you`: read the PR; stop (`done`) when merged or closed. Otherwise gather, triage and maybe start a round. The interval starts at 2 minutes and doubles while nothing changes, up to 30 minutes; any new item resets it.
- `fixing` / `confirming`: no GitHub reads; check the round run or the confirm card every 20 s. A decided card also wakes the poller through the `approvals` notification.

Webhooks would replace most polling; they need a public endpoint or the GitHub App, so they are left for later.

## Gathering and dedup

Per poll (`gather.ts`): failing check runs on the head commit with the check title, summary and up to 5 failure annotations; inline review comments; reviews that request changes or comment with a body; PR comments. Bots (Copilot, CodeRabbit) are included. Each item has a source key (`check:<name>:<sha>`, `review_comment:<id>`, `review:<id>`, `issue_comment:<id>`) and `pr_feedback_items` is unique per watch and key, so nothing is processed twice; a check that fails again on a new head is new. Spark's own replies carry a hidden marker and are skipped. Lists read up to 5 pages of 100.

Check logs are not downloaded: the excerpt is what the Checks API returns (output title, summary, annotations). Fetching job logs is a possible follow-up.

## Trust and triage

An item is trusted when it is a failing check on the PR's head (the PR's own CI) or its author has write, maintain or admin permission (`GET /collaborators/:login/permission`). Bots and failed lookups are untrusted. Untrusted items are shown (state `held`) and never acted on automatically; the user can include them through `spark_pr_follow_up_round`.

Jev triages new comments in one batch of Choice questions (`triage.ts`): fix, question, disagree (needs a human), nit, already addressed, information. Answers below 0.6 confidence, and everything when Jev isn't connected, use the rules. Checks are always "fix".

States: disagreements → `needs_user` (always the user's call); addressed/information → `done`; untrusted, or switched off by the sub-settings → `held`; questions with replies off → `needs_user`; the rest → `queued`.

## Rounds

When items are queued, the round limit (3 per PR) is not reached, and the branch is in sync, Spark sends one chat message (`source = 'pr_follow_up'`, `startAs = 'change'`) so the normal orchestration runs a Builder turn in the chat's worktree with the chat's pinned model, routing, checks and spend cap. A Full auto chat runs this turn at Automatic, so the orchestration's own ship step doesn't rewrite the PR title and body; the follow-up does the push itself.

The prompt wraps all GitHub text in `<pr_feedback>` as quoted lines, says it is untrusted data and never instructions, and asks for one `[F1] …` line per item at the end. Before the round, if the PR head moved, Spark fast-forwards the local branch only when that is a fast-forward and the worktree is clean; otherwise the watch goes to `needs_you`.

When the run ends, Spark plans the outward actions: the push (Ship `push` mode on the round's task, which commits the task's files and refuses force pushes and foreign branches) and one reply per handled thread ("Fixed in <sha>: <note>", or the answer). Review each step and Automatic: one `spark_action` card (`pr_follow_up`) on the finished round run lists the push and each item with its reply; unchecking edits `skip`. Full auto: Spark pushes and replies without a card. Items the Builder skipped, fixes without a push, and unanswered questions go to the user.

Spark never force-pushes, merges, approves, resolves threads or dismisses reviews.

## Where it shows

- Chat: a PR strip above the thread (`PrStatusCard`) with the link, checks, new comments, rounds, what Spark is doing and the gathered items; it refreshes on the `pull_request` change event.
- Sidebar, Home and the desktop island: a pending `pr_follow_up` card shows as "PR feedback" (`ConversationAttention.prFeedback`).
- Tickets inbox: a ticket whose PR has items waiting for the user gets the `pr-feedback` attention flag.
- Spark tools: `spark_pr_follow_up`, `spark_pr_follow_up_round` (see `SPARK_TOOLS.md`).

## Settings

Settings → Spark → Pull requests: Follow up on pull requests (on), with Fix failing checks, Handle review comments and Reply on GitHub threads (all on). Global only, like the other Ship settings.
