# Tickets screen plan

Design only. Nothing here is built in `apps/web` yet. The backend for Linear and Jira Cloud is merged from `feat/tickets` (`packages/contracts/src/tickets.ts`, `apps/server/src/tickets/`, `api/ticket-routes.ts`, `0054_tickets.sql`).

## Decisions (September 28, 2026)

1. **The inbox is the only layout.** The list and board mockups are removed (they are in git history at `0a3b94b`). The inbox has a Comfortable / Compact row density switch. Compact rows show one line; the reason for a flag becomes a short label.
2. **Search covers every ticket in the connected sources**, not just yours. Results are grouped as Assigned to you, Unassigned and Assigned to others. Any result can be assigned to you in one click (Linear `issueUpdate` with `assigneeId`; Jira `PUT /issue/{key}/assignee`).
3. **Smart views.** Every ticket assigned to you lands in exactly one: Needs attention, Working on, PR ready, In review (with its age, such as "in review 3 days"), Up next and Done recently.
4. **Filters:** source, team or project, sprint or cycle, priority, label, plus assignee while searching.
5. **Skeleton loading everywhere and no spinners.** Skeletons are shaped like the rows, sections, brief and detail they stand in for. Pending moves and "Assigning…" use a pulsing dot with text.
6. **Attention comes from rules first.** Deterministic rules flag the work and each flag says why. An optional AI brief then summarises only the flagged items.
7. **The brief lives on Home.** Home shows one attention feed for chats, tickets and PRs, and the Tickets inbox shows the ticket slice of that same feed. See "Where the brief lives".

## Mockups

Open them in a browser. The dashed bar at the top is not part of the app: it switches the screen, the state (URL hash) and Light/Dark. `?theme=dark` or `?theme=light` forces a theme. All data is made up (team "Acme", `example.atlassian.net`, `linear.app/acme`, and the people Riley Park, Jordan Lee, Sam Ortiz and Priya Nair).

| File | States |
| --- | --- |
| `tickets-mockup-inbox.html` | default, `#compact`, `#search` (search with unassigned results), `#assign-confirm` (taking a ticket from someone), `#assigned` (assigned, with undo), `#assign-error` (Jira refuses), `#no-results`, `#loading`, `#brief-writing`, `#brief-off`, `#brief-settings`, `#empty`, `#error` (token rejected), `#start`, `#start-context`, `#start-prompt`, `#settings`, `#settings-open`, `#settings-error`, `#connect`, `#connect-jira` |
| `home-brief-mockup.html` | default, `#writing`, `#failed`, `#off`, `#settings`, `#tickets` (the ticket slice), `#clear`, `#loading`, `#no-tickets` |

CSS tokens, fonts, rail, buttons, pills, provider cards, the Home layout (`home-hero`, `home-compose`, `hsec`, `hcard`, `mrow`) and the Settings panel are copied from `docs/design/mockup/spark-outpost-mockup.html`. New pieces use only those tokens.

## Tickets inbox

**Header.** Title, then one wide search field ("Search all tickets in Linear and Jira", `/` focuses it, Escape clears it), then the sync line ("Synced 1 min ago", or in red "Jira not synced since 11:02") and Refresh.

**Filter bar.** Selects for source, team or project, sprint or cycle, priority (Urgent, High and above, Medium and above) and label, plus assignee (Anyone, Me, Unassigned, or a person) while searching. An active filter is tinted and "Clear filters" appears. The density switch sits at the right end of the bar.

**Side column: views.** Inbox (all sections) and one entry per smart view with its count. Needs attention's count is amber when it's above zero. Under the list, the attention rules are written out in plain words. The rail's Tickets item shows the same Needs attention count as a badge.

**Brief strip.** At the top of the Inbox view in Comfortable density: "What needs you today", with up to 3 ticket items from the Home brief. Each item shows its rule flags and one quick action. A footer links to "Full brief on Home". It is a view of the Home brief and never calls a model itself. It shows as a skeleton while the brief is being written. When the brief is off, it says so and offers "Turn on (about $0.01 each)".

**Sections**, in this order. A ticket is placed in the first one that matches:

| View | Rule | Sorted by | Row shows | Quick actions |
| --- | --- | --- | --- | --- |
| Needs attention | Any attention rule matches (below) | Rule order, then priority | Every flag with its reason | Answer (chat asking), Retry (failed move), Open PR (slow review), otherwise Start |
| Done recently | Done in the last 7 days | Most recent first; collapsed by default | "Done 3 days ago" | none (open in the tracker from the detail) |
| PR ready | Has a draft PR from Ship | Newest PR first | Repo and number, Draft, "Review status not available yet" | Open PR, Open chat |
| Working on | Linked chat running or open, or the ticket is In progress | Latest activity | Chat state ("Running, step 3 of 5", "Finished 1 h ago, not shipped") | Open chat, or Start when there's no chat |
| In review | In review, no Spark PR | Longest in review first | "in review 2 days", "Reviewers not available yet" | Open PR, or open in the tracker |
| Up next | Everything else assigned to you that isn't started | Priority, then due date | Due date or "Assigned 2 days ago" | Start |

Until Spark reads PR status, a ticket with a Spark draft PR stays in PR ready even after the ticket moves to In review. Once the PR reader exists, PR ready means the PR is still a draft (your move) and In review means it's open and waiting on reviewers.

**Rows.** A status glyph, priority, source badge, key, title, then linked work (chat icon with a live dot, `#88` for the PR) and the age for that section. Comfortable rows add a second line: flags (in Needs attention), project and sprint, due date, and the tracker's own status name when it differs from the bucket ("Jira: Code Review"). Quick actions appear on hover, on focus within the row and on the selected row. In search, unassigned rows always show Assign to me. Each row is a list item with a main button (selects the ticket) and separate action buttons, so buttons are never nested.

**Detail pane** (420 px; below 1180 px it overlays the list). The actions come first: Assign to me (when it isn't yours), then Answer in chat or Open chat, Open PR, and Start work or Start again. Next come "Why it needs attention" (each flag with the rule's wording), the sync line, and the properties: status and time in it, priority, due, team or project, sprint or cycle, assignee, labels, updated. Then Linked work: the chat, the question the chat is asking, and a PR box whose Review, CI checks and Merged lines read "Not available yet". Then the description (loaded live), acceptance criteria, subtasks, links and comments.

**Search.** Typing replaces the sections with results. Skeleton rows show while the query runs, and a line gives the count and scope ("5 results for "upload" across all tickets in Linear and Jira"). Results are grouped as Assigned to you, Unassigned and Assigned to others. Each row shows the assignee's avatar or a dashed circle. With no results, the text names both sources and offers Clear filters and Clear search. When Jira's token is rejected, a note says its results are from 11:02.

**Assign to me.**

- Unassigned: one click. The row shows "Assigning in Linear" with a pulsing dot, then "Assigned to you" with Undo, and a toast "Assigned WEB-440 to you in Linear." with Undo. Undo stays available for 10 seconds.
- Assigned to someone else: a small confirm under the row, "Take WEB-437 from Jordan Lee? Linear makes you the assignee and notifies Jordan. You can undo for 10 seconds." with Cancel and Assign to me. Focus goes to Assign to me; Escape cancels and returns focus.
- Undo sets the previous assignee back, or clears the assignee. The toast says "Gave WEB-437 back to Jordan Lee." or "WEB-440 is unassigned again."
- Failure: an inline error under the row with the tracker's reason ("Jira says you can't assign issues in Engineering (ENG). Ask a project admin for the Assign issues permission. Nothing changed.").
- Start work on a ticket that isn't yours adds a checked "Assign WEB-440 to me in Linear" to the Start dialog.
- Assigning while the source's token is rejected is disabled, with "Reconnect Jira first".

**States.** Default; Compact; Search; Assign confirm, Assigned with undo, and Assign failed; No results; Loading (skeletons for the side column, brief, section headers, rows and detail, with an `aria-busy` region and hidden "Loading tickets from Linear and Jira"); Brief writing, off, and settings; Empty (no source: "Connect Linear or Jira", tokens stay in the keychain, and Spark changes a ticket only when you start work, open a draft PR or assign it to yourself); Token rejected (a banner naming Jira and the last good sync; Jira rows marked "Out of date" with Start, Assign and Retry disabled; Linear works as usual).

## Attention rules

The rules are deterministic, free and instant. Each flag carries its rule's wording ("Rule: High or Urgent, not started, assigned to you 2 or more days ago.") and its value ("assigned 3 days ago").

| Rule id | Flags when | Says |
| --- | --- | --- |
| `chat-asking` | A linked (or, on Home, any) chat is asking you | Chat is waiting for your answer · 20 min |
| `chat-error` | A chat stopped with an error (Home) | Stopped with an error · 1 h ago |
| `chat-review` | A chat finished and hasn't been opened since (Home) | Finished 2 h ago · not opened |
| `sync-failed` | Spark's last status move or PR link failed | Move to In Progress failed in Jira |
| `high-idle` | High or Urgent, To do, no chat, assigned 2 or more days ago | Urgent, not started · assigned 3 days ago |
| `due-soon` | Due within 2 days (or overdue), not in review or done | Due tomorrow · no chat yet |
| `review-slow` | In review 3 days or more | In review 4 days |
| `pr-changes` / `pr-ci` (later) | PR has changes requested / failing checks | needs the PR status reader |

The thresholds (2 days, 2 days, 3 days) are constants for now. Settings can expose them later if people ask. Items are ordered by rule (waiting on you, then errors and failed moves, then priority and dates), then by priority.

## The AI brief

- **Input: only the rule-flagged items and their metadata.** That means kind, key or chat title, status, priority, due date, PR repo and number, project, and the flags with their values. It never includes descriptions, comments, code or chat transcripts.
- **Output.** A one-line headline plus 3 to 5 items (`{ itemId, text }`) in the order to tackle them. The server checks every `itemId` against the input and drops unknown ones. It also drops a line that mentions a key, PR number or number of days that isn't in the input. The flags shown under each line come from the rules, not from the model. The footer says so: "The brief only orders and summarises what the rules flagged… It can't add items."
- **Model.** The user's default provider at the middle tier, never the fast tier or a retiring model. The digest already picks its model this way (`digestModel` in `apps/server/src/digest/model.ts`), so the brief reuses it. Today that is Sonnet 5 for Claude and 6 Sol or GPT-5.6 Terra for Codex.
- **When it runs.** On opening Home and on Refresh, only if the flagged set changed (a hash of item ids, flags and values), and at most every 30 minutes by default (15 min, 1 h, or "Only when I press Refresh" are the other options). With nothing flagged it doesn't call a model ("Nothing is flagged, so Spark didn't call a model."). The result is cached and shown with "Generated 09:12 · Sonnet 5 · ~$0.01 · from 7 flagged items", plus Audit (the existing digest audit dialog).
- **Cost.** About 2 to 3K input tokens and 300 output tokens, about $0.01 per brief at $2 / $10 per million tokens. At a 30-minute cap over a 10-hour day, that is at most about $0.20. Most days are far less, because unchanged feeds are skipped. The settings popover shows the per-brief estimate, the daily ceiling at the chosen interval and the month's spend.
- **Off switch.** "Write a brief with AI" in the brief settings popover (the gear next to Refresh, on Home and on the Tickets strip). When it's off, nothing is sent to a model and the rules still sort everything.
- **Failure.** The card keeps the last brief's time, shows the provider's reason ("Claude answered 529 (overloaded)… Nothing was charged.") and Retry, and says the list below is complete.

## Where the brief lives

**Recommendation: on Home, as the existing Digest card grown into "What needs you today".**

- Home already has an AI Digest card (`apps/web/src/home/DigestCard.tsx`). It has a scout head, a meta line with model and cost, Refresh, a minimum gap, "Show details", Audit and a writing skeleton. It also has a matching server job (`apps/server/src/digest/`: model choice, throttle policy, cost). The brief is the same job with a different input. One card and one model call a day beats a second AI summary on Tickets.
- The attention feed goes under the brief as "Needs you", replacing today's Home "Needs you" section. It has one list for chats, tickets and PRs and filter chips (All, Chats, Tickets, PRs). A ticket and its linked chat are one item. The Tickets chip is exactly what the Tickets inbox shows under Needs attention.
- Today's digest content ("what happened while you were away") moves into the brief's "Show what happened since you were away" disclosure, so the separate Digest card goes away.
- The Tickets inbox shows the ticket items of that brief as a strip, and Needs attention as its first section. It never generates its own brief.
- Home keeps Running now, then "Up next" (top 4 tickets) next to Recent chats. It replaces "Your tickets".

## Start work dialog

Unchanged from the first plan, apart from the assign checkbox. One column, top to bottom:

- The project folder, with the one linked to the ticket's project first.
- Plan first or Build.
- The permission (Ask, Ask before edits, Auto-edit, Full auto) next to "Move {key} to In progress in {Source}" (checked). For a ticket that isn't yours, "Assign {key} to me in {Source}" (checked) is added under it.
- **What the agent gets**, collapsed to one line with a token total and "+ Add context". Open, it has three parts:
  - **From {Source}:** a checkbox per piece, with its token estimate.
  - **Add context:** a note, files and images, `@` repo paths, links ("Fetched when the agent starts") and related tickets.
  - **Preview the exact prompt:** the text the agent receives.

The footer says "Creates a chat in {folder} and links {key} to it." and has Cancel and "Start with a plan" or "Start building". What `request.ts` sends today, and what the dialog still needs from the backend, is unchanged. The build can ship the collapsed line and the preview first.

## Settings → Connectors

Unchanged: compact rows that match the AI provider cards (logo, name, one status line, the Connected pill or Connect/Reconnect, a chevron; one row open at a time; a row in error opens by itself). The Linear and Jira descriptions now say they also search every issue you can see and assign one to you when you ask. Jira adds that this needs the Assign issues permission in that project. The open row keeps the facts (account, site, checked, "Saved in your macOS keychain"), Replace and Remove, the "Move tickets to In review when a draft PR opens" switch and the status mapping per team or project. "Checking with Linear…" uses the pulsing dot, not a spinner.

## Data each view needs, and what exists

| Need | Used by | Exists today | Needed |
| --- | --- | --- | --- |
| Tickets assigned to you | All sections | `GET /tickets` (`listAssigned`): key, title, bucket, own status, URL, updated, project, priority **label**, sprint, plus `work` (task, conversation, PR links) and per-source `errors` | Add to the summary: assignee `{ id, name }`, labels, due date (Linear `dueDate`, Jira `duedate`), priority **rank** (Linear `priority` 0 to 4, Jira priority order) |
| Done in the last 7 days | Done recently | `listAssigned` drops done tickets unless asked for a status | A `doneSince` filter (Linear `completedAt`, Jira `resolved >= -7d`) and `doneAt` |
| Assigned since | `high-idle`, Up next age | nothing | `tickets.first_seen_assigned_at`, set by the cache the first time a ticket shows up as yours |
| Time in current status | In review age, `review-slow` | nothing | Linear issue `history` (state changes), Jira `changelog` (status items). Fetch only for In review tickets, cache `status_since` |
| Last sync result | `sync-failed`, Retry after reload | `ticket_events` has it | `lastSync: { action, outcome, message, at }` on each list item (open since the first plan) |
| Chat state for linked work | `chat-asking`, Working on | chat queries, joined on `conversationId` | Join it into the list, or into the attention feed |
| **Ticket search API** | Search | none: both sources only list your tickets (`assignee = currentUser()`, `viewer.assignedIssues`) | `GET /tickets/search?q&source&project&sprint&priority&label&assignee`. Linear `searchIssues(term)` or `issues(filter)`; Jira `search/jql` with `text ~ q` (or `key = Q` when q looks like a key), no assignee clause. Returns summaries with assignee. One failing source doesn't hide the other. |
| **Assign API** | Assign to me, Undo, Start on someone else's ticket | `whoami` returns the Linear viewer id and Jira `accountId`, but the connection doesn't store it | `POST /tickets/:source/:key/assign { to: "me" \| accountId \| null, expected }`. Linear `issueUpdate(input: { assigneeId })`, Jira `PUT /rest/api/3/issue/{key}/assignee { accountId }`. Returns 409 when `expected` no longer matches (someone else changed it). Recorded in `ticket_events` as `assign`. Store the account id on connect. Undo is the same call with the previous assignee. |
| **PR status reader** | PR ready vs In review, reviewers, `pr-changes`, `pr-ci`, merged | Ship keeps the PR URL in `task_links`; `GitHubConnection` has `findPullRequest`, `createPullRequest` and `updatePullRequest` only. The harness plan says PR status, CI results and merging are not read. | `getPullRequest(repo, n)`: draft, state, merged, `ready_for_review` time, requested reviewers, review decision, check runs. Read through the same `gh` or token path, on open and Refresh, with ETags. Until then the UI shows "Not available yet". |
| **Attention rules engine** | Needs attention, Home feed, rail badges, brief input | none | A pure module (for example `packages/contracts/src/attention.ts` or `apps/server/src/attention/rules.ts`). It takes chats, tickets and PR info and returns items `{ id, kind, refs, flags: [{ rule, text, since }] }`, sorted. `GET /attention?kind=` serves the feed. Unit tests per rule and for the ordering. |
| **AI brief job + cost** | Home brief, Tickets strip | The digest job: `digestModel` (middle tier, non-retiring), `decideDigest` (10-minute minimum gap, auto after 60 minutes, skip when nothing is new), cost and model label on the digest row, audit | Brief input from the attention feed, output schema `{ headline, items: [{ itemId, text }] }` with the checks above, the refresh interval as a setting (15, 30 or 60 min, or manual), `brief.enabled`, the month-to-date cost for the settings popover, and "since you were away" folded in |
| Statuses per project | Status mapping editor | read when moving | A route that lists them (open since the first plan) |
| Last good sync per source, error kind | Token banner, "Out of date" | `errors` is a message string | `lastSyncedAt` per source and an error kind (token rejected, unreachable, rate limited) (open since the first plan) |

**Dependencies, in order.** The attention rules and the extra summary fields come first: the inbox works without search, assign or PR status. Then search and assign. The PR status reader is the only thing blocking "PR ready vs In review" and the two PR rules, and the UI already has a "Not available yet" state for it. The brief comes last, and it's optional by design.

## Keyboard and accessibility

- Every control is a native button, select, input or checkbox with a visible label or `aria-label`. Focus rings use the mockup's `:focus-visible` style.
- Rows are list items with a main button (`aria-current` when selected) and separate quick-action buttons, each named with the key ("Start API-84"). Quick actions show on `:focus-within`, so keyboard users see them.
- Keys for the build: `/` focuses search, Escape clears it, Up and Down move the selection, Enter opens the detail, `S` opens Start work, `A` assigns to me. Escape closes the confirm, the popover and the dialog and returns focus to where it was.
- Section headers are disclosure buttons (`aria-expanded`, `aria-controls`). Views in the side column are toggle buttons (`aria-pressed`). Density and theme are radio groups.
- Flags are text, never color alone. Each carries its rule as a `title`, and compact rows keep the full reason as hidden text.
- The assign confirm is a non-modal dialog labelled by its question. The Start dialog and Settings are modal dialogs (the build needs a focus trap and focus return). The brief settings popover is a labelled dialog with a real switch.
- Loading regions carry `aria-busy` and a hidden status line; skeletons are `aria-hidden`. Search results announce their count. Toasts use a polite live region; banners and inline errors use `role="alert"`.
- axe (WCAG 2.0, 2.1 and 2.2 A and AA tags) reports no violations in any listed state of either mockup, in light and dark. The click-through covers sections, views, density, filters, brief refresh, brief settings and the off switch, `/` search, the search skeleton, assign, undo, the confirm with Escape, the Jira assign error, Start from a quick action with focus return, Start on an unassigned ticket with the assign checkbox, Retry, Settings, the token-rejected disabled states, and the Home feed filter, brief off and on, and "since you were away".
- Motion follows the mockup, including `prefers-reduced-motion`. Skeleton shimmer stops under reduced motion.

## Open questions

1. Should "Assign to me" on a ticket someone else owns always confirm (as mocked), or only for In progress tickets?
2. Are the rule thresholds (2 days idle, due within 2 days, 3 days in review) right, and do you want them in Settings?
3. Should Done recently show 7 days, or since the start of the sprint or cycle?
4. Should Home's brief replace the Digest card outright (recommended), or sit above it for a release?
5. Is 30 minutes the right default cap for the brief, and should the brief also run once in the morning without you opening Home?
6. Search scope: every project you can see, or only the teams and projects you've been assigned tickets in before?
7. When the PR reader lands, should a merged PR move the ticket to Done (Spark never closes tickets today)?
