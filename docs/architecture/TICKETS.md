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

Spark's Jira connection is email + API token (Basic). It has no OAuth 3LO connection.

Chosen: the endpoints the Jira issue view uses.

- `GET /rest/dev-status/latest/issue/summary?issueId={id}`: counts per kind, last commit time, build counts.
- `GET /rest/dev-status/latest/issue/detail?issueId={id}&applicationType={type}&dataType=pullrequest|branch`: only for kinds and application types the summary reports, at most three types.

Why: no supported public API returns the linked pull requests. Atlassian states these endpoints are internal, unsupported, may change without notice, and work with Basic email + API token ([JSWCLOUD-16901](https://jira.atlassian.com/browse/JSWCLOUD-16901)). The issue `development` custom field only carries a summary string without URLs ([community thread](https://community.developer.atlassian.com/t/fetch-development-field-data-from-a-jira-issue/69558)). The GraphQL `developmentInformation` query is internal-only and not grantable to OAuth 2.0 or scoped tokens ([JRACLOUD-96045](https://jira.atlassian.com/browse/JRACLOUD-96045), [JRACLOUD-97504](https://jira.atlassian.com/browse/JRACLOUD-97504)). An OAuth 3LO connection, if added later, must not assume dev-status works.

Because the endpoint is internal:

- Answers are validated with strict schemas (`tickets/jira-development.ts`); URLs must be http(s). Anything else counts as a failure.
- A failure never fails the ticket. The ticket carries `development.availability = 'unavailable'`, the detail says "Development info unavailable from Jira", and there is no toast and no source error.
- Results are cached per ticket in `ticket_development`: 10 minutes when read, 5 minutes when unavailable; the detail view refreshes after 1 minute. Disconnecting or reconnecting the source clears the cache.
- One inbox refresh reads at most 25 stale tickets, four at a time, oldest first, and never tickets that are done. After three failures in one refresh the rest are marked unavailable without a request.
- Requests time out after 8 seconds.

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
