# Tickets: development information

How a ticket gets its pull requests, branches, commits and builds, and which pull request the inbox follows.

## Sources, merged per ticket

| Origin    | Where it comes from                                                                 | Shown as              |
| --------- | ----------------------------------------------------------------------------------- | --------------------- |
| `spark`   | `ticketWork`: pull requests opened by chats started from the ticket                 | Spark chat            |
| `linked`  | The ticket system: Jira development information; pull request links on the ticket   | Linked in Jira/Linear |
| `matched` | Open pull requests in linked project repositories whose branch or title has the key | Matched by key        |

`tickets/development-merge.ts` merges them by pull request URL (query, fragment and trailing slash ignored). Spark's record wins the origin; missing title, branch and author are filled from the other sources. Key matching runs only for a ticket with no Spark and no linked pull request.

## Jira Cloud: dev-status (best effort)

Spark's Jira connection is the Atlassian connector's email + API token (Basic), see `ATLASSIAN.md`. It has no OAuth 3LO connection.

Chosen: the endpoints the Jira issue view uses.

- `GET /rest/dev-status/latest/issue/summary?issueId={id}`: counts per kind, last commit time, build counts.
- `GET /rest/dev-status/latest/issue/detail?issueId={id}&applicationType={type}&dataType=pullrequest|branch`: only for kinds and application types the summary reports, at most three types.

Why: no supported public API returns the linked pull requests. Atlassian states these endpoints are internal, unsupported, may change without notice, and work with Basic email + API token ([JSWCLOUD-16901](https://jira.atlassian.com/browse/JSWCLOUD-16901)). The issue `development` custom field only carries a summary string without URLs ([community thread](https://community.developer.atlassian.com/t/fetch-development-field-data-from-a-jira-issue/69558)). The GraphQL `developmentInformation` query is internal-only and not grantable to OAuth 2.0 or scoped tokens ([JRACLOUD-96045](https://jira.atlassian.com/browse/JRACLOUD-96045), [JRACLOUD-97504](https://jira.atlassian.com/browse/JRACLOUD-97504)). An OAuth 3LO connection, if added later, must not assume dev-status works.

Because the endpoint is internal:

- Answers are validated with strict schemas (`tickets/jira-development.ts`); URLs must be http(s). Anything else counts as a failure.
- A failure never fails the ticket. The ticket carries `development.availability = 'unavailable'`, the detail says "Development info unavailable from Jira", and there is no toast and no source error.
- Results are cached per ticket in `ticket_development`: 10 minutes when read, 5 minutes when unavailable; the detail view refreshes after 1 minute. Disconnecting or reconnecting the source clears the cache.
- One inbox refresh reads at most 25 stale tickets, four at a time, oldest first, and never tickets that are done. After three failures in one refresh the rest are marked unavailable without a request.
- One ticket's development read (summary plus details) has 8 seconds in total; the ticket detail waits for it at most that long.

Contract tests run against the fake in `apps/server/test/fake-jira-dev.ts`. Nothing is verified against a real Jira site; Jira Data Center and scoped API tokens are untested.

## Linear

Linear's attachments already come with the ticket detail, so pull request links on a Linear ticket show as `linked` in the detail. The inbox does not read attachments for every ticket (it would add a nested connection to the list query); Linear tickets in the inbox get `spark` and `matched` only. `TicketSource.development` is the seam for a source that can return this cheaply.

## Key matching

`tickets/github-pulls.ts` lists open pull requests (first 100, newest update first) for up to 10 repositories linked as projects: one request per repository per refresh, cached for 2 minutes and dropped when the project list changes. GitHub search is not used because it cannot match a key inside a branch name. A key matches when it is not preceded or followed by a letter or digit, in any case.

## Status

`tickets/pull-status.ts` reads state, review and checks from GitHub for Spark's latest pull request and up to two open non-Spark pull requests per ticket in the inbox (six in the detail). When the GitHub connection cannot read the repository, Spark shows what the ticket system reported (title, state, link, last update) and says the status is from it.

## The pull request the inbox follows

`attentionPull` picks one pull request per ticket for sections, the row badge and attention rules:

1. Spark's latest pull request, while it is open, merged or unread. This keeps move-on-merge, PR follow-up state and Done placement as before.
2. Otherwise an open pull request that is `linked` (anyone's) or `matched` and mine: mine first, linked before matched, then newest update.
3. Otherwise Spark's closed pull request, or none.

Merged or declined pull requests Spark did not open are listed but never move a ticket to Done or change it in the ticket system.

"Mine" means Spark opened it, or its GitHub author is one of the connected GitHub logins. A pull request that is not mine can place the ticket in In review / PR open, but never raises `pr-approved`, `pr-changes`, the failing-checks notice, or `review-slow` (unless the ticket's own status is in review). A pull request whose status came from the ticket system is never mine.

For a ticket not in review in the ticket system, `review-slow` counts from the later of the status change and the pull request's opening.

## Moving the ticket when a pull request opens

A pull request a chat opened (publish step, Ship, the agent's `gh pr create` or `spark_pull_request`) moves the chat's tickets to their review status once per pull request; see `PR_FOLLOW_UP.md#when-a-pull-request-opens`. A ticket counts when the chat was started from it or the user linked it, or when its key is in the branch or pull request title and it is a Jira or Linear ticket in a connected source (cached, or found with `getSummary` when the key is written in capitals). Key matching here is separate from the inbox's `matched` origin above and never links the ticket to the task, so merging moves only the task's tickets, as before. The source's move-on-open switch, the move rules and ServiceNow's refusal hold.

## The inbox snapshot, backoff and caches

`loadInbox` (`tickets/inbox.ts`) is called by `GET /api/tickets/inbox`, the `spark_tickets` list tool and the morning brief. It no longer syncs on every call. State is in memory, per database and workspace (`tickets/inbox-snapshot.ts`), so one workspace never reads another's snapshot.

| Layer                   | What it does                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-flight sharing       | Concurrent loads for one workspace share one sync (`shareSync`). A sync started before an invalidation is not joined by later callers.                                                        |
| Freshness window        | `FRESH_WINDOW_MS` (20 s). A load inside it re-reads only local facts (marks, snooze, dismissals, work and chats, last sync, PR feedback) and re-places the tickets. No source or GitHub call. |
| Refresh                 | `GET /api/tickets/inbox` with `Cache-Control: no-cache`, sent only by the Tickets header's Refresh button. It skips the window and the pull request cache. It never skips a source's backoff. |
| Mark routes             | Snooze and dismiss keep their 60 s `reloadInboxMarks` path: marks only, from the last snapshot.                                                                                               |
| Pull request status     | `tickets/pull-status-cache.ts` keeps each status read for 90 s with in-flight sharing. Only the inbox's `inboxDevelopment` passes it; the ticket detail, Ship and PR follow-up read fresh.    |
| Development information | Unchanged: `ticket_development`, 10 minutes.                                                                                                                                                  |

### What invalidates the snapshot

`recordTicketEvent` calls `afterTicketEvent` listeners, and `inbox-snapshot.ts` bumps the workspace generation. A snapshot of an older generation is never served, and a sync that finishes under an older generation is stored but not reused. Every change path records a ticket event: moves (the move route, Start work, the PR-open move, the merged move, `spark_transition_ticket`), comments (route and tool), assignments, link-PR, create, and connect, disconnect and settings changes (which also forget that source's backoff and last good read). The API process also drops the snapshot and the whole pull request status cache on a `pull_request` app event (its payload names a chat, not a pull request, so the cache is dropped as a whole); connecting, disconnecting or changing a ticket source drops the status cache too. Otherwise the status cache expires after 90 s or on Refresh.

The chat worker has its own memory. A change made in the API process reaches a worker's `spark_tickets` list only when its window (20 s) ends.

### Rate limits

`failure()` in `tickets/http.ts` attaches `retryAfterMs` to a `TicketApiError` for 429 and 503. `Retry-After` is read as seconds or an HTTP date (`tickets/retry-after.ts`): a missing or unreadable value waits 60 s, and the wait is held between 1 s and 10 minutes.

While a source waits (`tickets/source-backoff.ts`) the inbox does not call it, including its development reads. It lists the source's tickets from the last good read and adds one problem line naming the status and the time Spark asks again. The other sources sync normally. A good read, or connecting, disconnecting or changing the source, clears the wait. Authentication and network errors do not back off and list no tickets, as before.

### Moving a merged ticket to Done

The move that follows a merged pull request still happens in the read path, once per ticket and pull request: the claim is `whileClaimingMergeMove` (`pg_try_advisory_xact_lock` plus a second `mergeMoveTried` check), taken one at a time inside a process, so two loads or two processes cannot both transition it. A load that loses the claim lists the ticket as it was, and the next load shows it done.
