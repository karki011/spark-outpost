# Tickets screen plan

Reference for the Tickets screen and the Home brief. Both are built: the backend for Linear and Jira Cloud (`packages/contracts/src/tickets.ts`, `apps/server/src/tickets/`, `apps/server/src/api/ticket-routes.ts`, migrations from `0054_tickets.sql`) and the inbox UI (`apps/web/src/tickets/`, about 45 files). This doc records the decisions behind the current design and lists what's still open; treat "Decisions" and "Rules" as descriptive of the code, not a backlog.

## Decisions

1. **The inbox is the only layout.** The list and board mockups are removed (they are in git history at `0a3b94b`). The inbox has a Comfortable / Compact row density switch. Both densities use the same one-line row; Compact only makes it shorter (32 px instead of 40 px) and hides the brief strip.
2. **Search covers every ticket in the connected sources**, not just yours. Results are grouped as Assigned to you, Unassigned and Assigned to others. Any result can be assigned to you in one click (Linear `issueUpdate` with `assigneeId`; Jira `PUT /issue/{key}/assignee`). Built: `GET /tickets/search`.
3. **Flow groups.** Every ticket assigned to you lands in exactly one group, from the tracker status and Spark's activity together: Needs you, In progress with Spark, Started, Up next, In review / PR open and Done recently. A side column of views lists Inbox and each group with its live count, like the folders of a mail app, and filters the list; below 900 px it becomes a row of pills above the list.
4. **Filters:** source, team or project, sprint or cycle, priority, label, plus assignee while searching.
5. **Skeleton loading everywhere and no spinners.** Skeletons are shaped like the rows, sections, brief and detail they stand in for. Pending moves and "Assigning…" use a pulsing dot with text.
6. **Attention comes from rules first.** Deterministic rules flag the work and each flag says why. An optional AI brief then summarises only the flagged items.
7. **The brief lives on Home.** Home shows one attention feed for chats, tickets and PRs, and the Tickets inbox shows the ticket slice of that same feed. See "Where the brief lives".
8. **Scannable rows.** A row is one line: priority, key, the tracker's own status as a badge (colour and icon by category, never colour alone), title, then the Spark progress or the single most important reason, a compact age and the assignee's avatar (a dashed circle when unassigned). The flow group is the section header and the side column, not a second badge. No source badge, no project or sprint, no tracker status text. Hover or focus shows a short preview; everything else is in the detail pane. See "Rows".
9. **Linked work in the row and chat linking.** Rows end with a fixed-width links column: a chat button (state dot for asking, running, error) and a compact PR badge with its number whose glyph names the state (draft, open, checks failing, changes requested, approved, merged, closed). Both open their target directly (the PR in the default browser); the column is always reserved, so nothing jumps. A chat links itself to a ticket only when it is working on it: Start work, or a build turn (intake start build or plan first) that names exactly one ticket as its target ("fix ABC-123", "ABC-123: …", a pasted ticket link). A ticket cited as a reference ("see", "similar to", "analyse", Ask turns) is only shown as a "Mentions ABC-123" line with "Link this chat"; several tickets, or a reference in a build turn, give a "Link this chat to ABC-123 / ABC-124?" suggestion. Linked tickets show as a chip in the chat header with Unlink; an unlinked ticket is never re-linked automatically in that chat. Once linked, the chat branch starts with the key and the Ship title and body name it; mentions never move ticket status.
10. **Snooze ("Remind me later").** A ticket can be snoozed until a chosen time (`PUT`/`DELETE /tickets/:source/:key/snooze`); snoozed tickets move to their own "Snoozed" view and drop out of the other sections until they wake.
11. **Notices, not Needs you, for CI.** Failing checks on a ticket's open PR are a notice: the ticket stays in its flow group (In review / PR open) with a checks badge, and the rail's Tickets item shows an unnumbered dot until the ticket or its PR is opened. A notice is identified by the PR and its head commit, so the same failure never comes back and a new failing push does. Checks still running are never a notice.
12. **Dismiss.** A Needs you ticket can be dismissed (`PUT`/`DELETE /tickets/:source/:key/dismiss`): its current flags are hidden until their state changes (a new question, a new failed move, a different due text) or they clear and come back. Unlike snooze it has no time and no Snoozed view.

## Mockups

Open them in a browser. The dashed bar at the top is not part of the app: it switches the screen, the state (URL hash) and Light/Dark. `?theme=dark` or `?theme=light` forces a theme. All data is made up (team "Acme", `example.atlassian.net`, `linear.app/acme`, and the people Riley Park, Jordan Lee, Sam Ortiz and Priya Nair).

| File | States |
| --- | --- |
| `tickets-mockup-inbox.html` | default, `#compact`, `#search` (search with unassigned results), `#assign-confirm` (taking a ticket from someone), `#assigned` (assigned, with undo), `#assign-error` (Jira refuses), `#no-results`, `#loading`, `#brief-writing`, `#brief-off`, `#brief-settings`, `#empty`, `#error` (token rejected), `#start`, `#start-context`, `#start-prompt`, `#settings`, `#settings-open`, `#settings-error`, `#connect`, `#connect-jira` |
| `home-brief-mockup.html` | The integrated Home design target: default, `#tickets` (the ticket slice), `#all-quiet`, `#quiet-bare`, `#no-tickets`, `#writing`, `#failed`, `#off`, `#settings`, `#no-ai`, `#loading`, `#narrow` |

CSS tokens, fonts, rail, buttons, pills, provider cards, the Home layout (`home-hero`, `home-compose`, `hsec`, `hcard`, `mrow`) and the Settings panel are copied from `docs/design/mockup/spark-outpost-mockup.html`. New pieces use only those tokens.

## Tickets inbox

**Header.** Title, then one wide search field ("Search all tickets in Linear and Jira", `/` focuses it, Escape clears it), then the sync line ("Synced 1 min ago", or in red "Jira not synced since 11:02") and Refresh.

**Filter bar.** Selects for source, team or project, sprint or cycle, priority (Urgent, High and above, Medium and above) and label, plus assignee (Anyone, Me, Unassigned, or a person) while searching. An active filter is tinted and "Clear filters" appears. The density switch sits at the right end of the bar.

**Side column** (236 px, `TicketViews.tsx`). "Views": Inbox with the total, then one item per group with its count (Needs you in the warn colour; empty groups stay, muted), and Snoozed when something is snoozed. Each item is a toggle button (`aria-pressed`); Up, Down, Home and End move between them, and the choice is remembered on this computer. Picking a view clears a search. The attention rules sit at the foot. Below 900 px the column turns into a row of pills above the list (empty groups hidden), and at phone width that row scrolls sideways. The rail's Tickets item shows the Needs you count as a badge.

**Brief strip.** At the top of the Inbox view in Comfortable density: "What needs you today", with up to 3 ticket items from the Home brief. Each item shows its lead reason as plain text (the same words as its row) and one quick action. A footer links to "Full brief on Home". It is a view of the Home brief and never calls a model itself. It shows as a skeleton while the brief is being written. When the brief is off, it says so and offers "Turn on (about $0.01 each)".

**Groups**, in this order. A ticket is placed in the first one that matches:

| Group | Rule | Sorted by | Row shows | Quick actions |
| --- | --- | --- | --- | --- |
| Needs you | Any attention rule matches (below), including a linked chat asking or stopped | Rule order, then priority | What the chat asks for ("Approve plan", "Answer a question") or the first flag's reason ("PR #88 changes requested", "Due tomorrow"), +N for more | Answer, Open PR, Start, or none when the only flag is a failed move |
| In progress with Spark | A linked chat is running | Latest start first | The Spark and plan progress, "8/10 · Pip working", with the Spark's blob face in the chip | Open chat |
| Started | In progress in the tracker, or a linked chat finished or idle, and no chat running | Priority, then latest update | "In progress · no chat", "Chat finished · not shipped" | Open chat, or Start |
| Up next | Everything else assigned to you that isn't started | Priority, then due date | "Due Oct 6" or "Not started" | Start |
| In review / PR open | In review in the tracker, or its PR is open (draft included) | Longest in review first | "PR #341" with a checks badge (Checks passing, Checks running, Checks failing), "Draft PR #231", "In review" | Open PR |
| Done recently | Done, or its PR merged, in the last 7 days | Most recent first; collapsed by default | "Done", "PR #88 merged" | none |

The screen joins each linked chat's live state (from the chat list that live events keep fresh) onto its ticket, so a chat that starts asking moves its ticket to Needs you, and plan progress ticks, without a reload; the inbox is then refetched so the server's grouping catches up. A pull request watch changing (checks, draft, merged) also refetches the inbox.

Spark reads PR status (`apps/server/src/tickets/pull-status.ts`, `getPullRequest`): a draft or open PR places the ticket in In review / PR open, failing checks add a notice and a red checks badge there (never Needs you), and a merged PR moves it to Done recently. Checks count as failing only once every check run on the head commit has completed and at least one concluded failure, timed out, cancelled or action required; while any run is queued or in progress they are running. Required and optional checks are not told apart (that needs branch protection or GraphQL access the REST reads don't have).

**Rows.** One line, the same height in every section (40 px Comfortable, 32 px Compact); two lines only when the list itself is narrower than 760 px (a container query, so it also applies beside an open detail pane), where the chip, reason, age and assignee move under the title. At phone width the title wraps to two lines.

`[source letter] [priority] [KEY] [status badge] [Title] ... [Spark progress or reason] [+N] [sync glyph] [age] [assignee] [links]`

- **Status badge** (`StatusChip.tsx`, shared by rows, search results, the detail pane, subtasks and the Start dialog): the tracker's status name ("In Progress", "Code Review", "Ready for implementation") in a fixed-width column, coloured by category: to do (neutral outline), in progress (accent), in review (warn), blocked (danger; the name says blocked or on hold) and done (success). The category comes from the source's own status category and the status mapping, so custom names land in the right one. The reason keeps its severity dot, or the Spark's face while a chat runs.

- **Priority** glyph (bars, or the amber `!` for Urgent). **Key** in muted mono. **Title** takes the rest and truncates.
- **Reason**: the single most important reason for this row, as plain muted text. In Needs you it's what the chat asks for or the first matching rule's words: "Approve plan", "Move failed in Jira", "Urgent · not started", "Due tomorrow", "PR #88 in review". Other groups say what is happening: "8/10 · Pip working", "Draft PR #231", "PR #341 · checks passing", "Due Oct 6", "Done". In search it says whose it is: "Assigned to you", "Unassigned", "Assigned to Jordan Lee".
- **Age**: compact (`20m`, `3d`, `today`), right-aligned in a fixed column, with a `title` that says what it measures ("Asked 20 min ago", "Assigned 3 days ago", "In review for 4 days"). Together with the reason it reads "Waiting for your answer 20m", "Urgent · not started 3d", "PR #88 in review 4d".
- **More flags**: a muted `+1` after the reason, with the other reasons as its `title` and hidden text. The detail pane lists every reason with its rule.
- **Sync problems**: a small red warning glyph with a tooltip ("Could not move API-81 to In Progress in Jira. Details and Retry in the ticket."), amber "Out of date" when the source's token is rejected, a pulsing dot while a move is pending. The error text and Retry live in the detail pane only.
- **Source**: not shown by default. With All sources selected, a tiny source letter (L or J) appears at the left edge on hover, focus or selection. The key prefix and the detail pane name the source.
- **Dropped from the row**: source badge, project and sprint (group headers and filters cover them), the tracker's own status name ("Jira: Code Review", now only in the detail), and the status circle (the chip replaces it; search rows keep it because results are mixed).
- **Actions**: at most one per row, a ghost button (the primary verb is outlined in the accent color), shown only on hover, on focus within the row and on the selected row. It takes the place of the reason and age, so the row never changes height or shifts. Answer, Start, Open PR, Open chat, Assign to me. "Assigning in Linear" and "Assigned to you · Undo" stay visible while they apply.
- **Selection**: the selected row has a tinted background and a 3 px accent bar on the left. Up and Down (or J and K), Home and End move focus between rows, and Enter opens one; while the detail pane is open, moving also selects, so the detail follows. Focusing a row shows its preview (title, status, chat, PR, other flags, priority, age); the focus ring is drawn inside the row.
- Each row is a list item with a main button (selects the ticket) and a separate action button, so buttons are never nested.

**Section headers.** Chevron, name and count only ("Needs you 4"), with an info button whose tooltip gives the rule ("Flagged by rules; each row says why."). The tooltip shows on hover and keyboard focus, stays while hovered and closes with Escape. Search group headers work the same way.

**Detail pane** (500 px by default; drag its left edge, or focus it and use the arrow keys, Home, End and Enter to reset; the width is remembered and the list always keeps 380 px; below 1180 px it overlays the list; from 1500 px an empty pane says "Select a ticket to see its details" until one is picked). The actions come first: Assign to me (when it isn't yours), then Answer in chat or Open chat, Open PR, and Start work or Start again. Dismiss sits next to Remind me later on a Needs you ticket. Next come "Why it needs attention" (each flag with the rule's wording; not shown for a notice, where the Pull requests block moves up here instead with the review state, the checks badge and the names of the failed checks), the sync line, and the properties: status and time in it, priority, due, team or project, sprint or cycle, assignee, labels, updated. The properties include the reporter and the created date (relative, exact date on hover; "Not known" when the tracker has none). Then Linked work (the chat) and Pull requests: the PR Spark opened with its state and checks, plus pull requests the tracker links (Jira remote links, Linear attachments), each opening in the browser. Then the description (loaded live), acceptance criteria, subtasks, links and comments.

**Search.** Typing replaces the sections with results. Skeleton rows show while the query runs, and a line gives the count and scope ("5 results for "upload" across all tickets in Linear and Jira"). Results are grouped as Assigned to you, Unassigned and Assigned to others. Each row keeps the status circle and says whose it is in the reason slot ("Unassigned", "Assigned to Jordan Lee"). With no results, the text names both sources and offers Clear filters and Clear search. When Jira's token is rejected, a note says its results are from 11:02.

**Assign to me.**

- Unassigned: one click. The row shows "Assigning in Linear" with a pulsing dot, then "Assigned to you" with Undo, and a toast "Assigned WEB-440 to you in Linear." with Undo. Undo stays available for 10 seconds.
- Assigned to someone else: a small confirm under the row, "Take WEB-437 from Jordan Lee? Linear makes you the assignee and notifies Jordan. You can undo for 10 seconds." with Cancel and Assign to me. Focus goes to Assign to me; Escape cancels and returns focus.
- Undo sets the previous assignee back, or clears the assignee. The toast says "Gave WEB-437 back to Jordan Lee." or "WEB-440 is unassigned again."
- Failure: an inline error under the row with the tracker's reason ("Jira says you can't assign issues in Engineering (ENG). Ask a project admin for the Assign issues permission. Nothing changed.").
- Start work on a ticket that isn't yours adds a checked "Assign WEB-440 to me in Linear" to the Start dialog.
- Assigning while the source's token is rejected is disabled, with "Reconnect Jira first".

**States.** Default; Compact; Search; Assign confirm, Assigned with undo, and Assign failed; No results; Loading (skeletons for the side column, brief, section headers, rows and detail, with an `aria-busy` region and hidden "Loading tickets from Linear and Jira"); Brief writing, off, and settings; Empty (no source: "Connect Linear or Jira", tokens stay in the keychain, and Spark changes a ticket only when you start work, open a draft PR or assign it to yourself); Token rejected (a banner naming Jira and the last good sync; Jira rows get an amber "Out of date" glyph, with Start, Assign and Retry disabled; Linear works as usual).

## Row layout as built

The build departs from the mockup's rows in four ways, after feedback from a 69-ticket Jira inbox.

- Hover and focus never hide a cell. The row action (Start, Open chat, Open PR, Answer, Assign to me) fades into a fixed slot at the end of the row; the selected row keeps it showing, and touch screens always show it.
- Each group is one grid that its rows share (subgrid), so priority, key, status, title, age and assignee line up in every group. The status badge is as wide as its label inside a fixed column. The work-state column is as wide as the longest line in its group, up to 230px, and the chat and PR links sit beside it.
- The work-state cell stays empty when the status badge already says it: not started with no due date, started with no chat, and done with no merged pull request. A done ticket with a merged pull request says "PR #N merged".
- Attention rules in the side column is a collapsed disclosure. The same text is on the Needs you group's info button.
- In In review / PR open the work-state cell is the PR ("PR #341") followed by a checks badge in the status badge's style; a dot inside the badge marks a notice that hasn't been opened. The PR link in the links column still turns red with failing checks, as in the mockup.
- With a notice and no flag, the detail pane shows Pull requests above the properties, where "Why it needs attention" would be.

## Attention rules

The rules are deterministic, free and instant. Each flag carries its rule's wording ("Rule: High or Urgent, not started, assigned to you 2 or more days ago.") and its value ("assigned 3 days ago"). A row shows the short form below; the detail pane shows the long form and the rule.

| Rule id | Flags when | Says |
| --- | --- | --- |
| `chat-asking` | A linked (or, on Home, any) chat is asking you | Waiting for your answer · 20m |
| `chat-error` | A chat stopped with an error (Home) | Stopped with an error · 1h |
| `chat-review` | A chat finished and hasn't been opened since (Home) | Finished · not opened · 2h |
| `sync-failed` | Spark's last status move or PR link failed | Move failed in Jira (as a glyph when another reason leads) |
| `blocked` | The status or a label says it's blocked | Blocked |
| `high-idle` | High or Urgent, To do, no chat, assigned `idleDays` or more days ago | Urgent · not started · 3d |
| `due-soon` | Due within `dueDays` (or overdue), not in review or done | Due tomorrow |
| `review-slow` | In review `reviewDays` or more | PR #88 in review · 4d |
| `pr-changes` | PR has changes requested | Changes requested |
| `pr-approved` | PR is approved | Approved |

Failing checks are not a rule: they are a notice (decision 11), raised when checks have finished failing on the linked open PR and no chat is running. The `pr-checks` id stays in the contract only because saved snoozes may name it.

The thresholds (`idleDays`, `dueDays`, `reviewDays`) are per-workspace settings (`apps/server/src/persistence/attention-settings.ts`, defaults in `@spark-outpost/contracts`), not constants. Items are ordered by rule (waiting on you, then errors and failed moves, then priority and dates), then by priority.

## The AI brief

- **Input: only the rule-flagged items and their metadata.** That means kind, key or chat title, status, priority, due date, PR repo and number, project, and the flags with their values. It never includes descriptions, comments, code or chat transcripts.
- **Output.** A one-line headline plus 3 to 5 items (`{ itemId, text }`) in the order to tackle them. The server checks every `itemId` against the input and drops unknown ones. It also drops a line that mentions a key, PR number or number of days that isn't in the input. The flags shown under each line come from the rules, not from the model. The footer says so: "The brief only orders and summarises what the rules flagged… It can't add items."
- **Model.** The user's default provider at the middle tier, never the fast tier or a retiring model. The digest already picks its model this way (`digestModel` in `apps/server/src/digest/model.ts`), so the brief reuses it. Today that is Sonnet 5 for Claude and 6 Sol or GPT-5.6 Terra for Codex.
- **When it runs.** On opening Home and on Refresh, only if the flagged set changed (a hash of item ids, flags and values), and at most every 30 minutes by default (15 min, 1 h, or "Only when I press Refresh" are the other options). With nothing flagged it doesn't call a model ("Nothing is flagged, so Spark didn't call a model."). The result is cached and shown with "Generated 09:12 · Sonnet 5 · ~$0.01 · from 7 flagged items", plus Audit (the existing digest audit dialog).
- **Cost.** About 2 to 3K input tokens and 300 output tokens, about $0.01 per brief at $2 / $10 per million tokens. At a 30-minute cap over a 10-hour day, that is at most about $0.20. Most days are far less, because unchanged feeds are skipped. The settings popover shows the per-brief estimate, the daily ceiling at the chosen interval and the month's spend.
- **Off switch.** "Write a brief with AI" in the brief settings popover (the gear next to Refresh, on Home and on the Tickets strip). When it's off, nothing is sent to a model and the rules still sort everything.
- **Failure.** The card keeps the last brief's time, shows the provider's reason ("Claude answered 529 (overloaded)… Nothing was charged.") and Retry, and says the list below is complete.

## Where the brief lives

Home shows one "What needs you today" section: a brief panel (`apps/web/src/home/BriefPanel.tsx`, the old Digest card grown to cover tickets and PRs) plus a lean attention feed (`apps/web/src/home/NeedsFeed.tsx`) for chats, tickets and PRs. The Tickets inbox shows the ticket items of that same brief as a strip (`BriefStrip.tsx`) above its sections, and Needs you as its first group; the inbox never starts its own brief. Home keeps Running now (full width, hidden when empty, shows the ticket key when a running chat is linked), then "Up next" (top 4 tickets) next to Recent chats. See "Open items" below for what's still incomplete.

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

## Data each view needs, and what's built

Built: ticket summary fields including `first_seen_assigned_at` and `status_since` (migration `0056_tickets_inbox.sql`), `GET /tickets/search`, the assign API (`POST /tickets/:source/:key/assign`), the snooze API, the PR status reader (`apps/server/src/tickets/pull-status.ts`, `getPullRequest`), and the attention rules engine (`apps/server/src/tickets/attention.ts`).

Not built, still needed:

| Need | Used by | Gap |
| --- | --- | --- |
| Done-since filter | Done recently | No `doneSince` filter or `doneAt` field; `listAssigned` just drops done tickets unless asked for a status |
| Per-source last sync, error kind | Token banner, "Out of date" | `errors` is a message string; no `lastSyncedAt` per source with an error kind (token rejected, unreachable, rate limited) |
| Statuses per project | Status mapping editor | No route lists them; status is only read when moving a ticket |

## Open items

Carried over from the tickets and Home-brief design work, still open:

1. Should "Assign to me" on a ticket someone else owns always confirm, or only for In progress tickets?
2. Are the rule thresholds (`idleDays`, `dueDays`, `reviewDays`) right as defaults?
3. Should Done recently show 7 days, or since the start of the sprint or cycle?
4. Search scope: every project you can see, or only the teams and projects you've been assigned tickets in before?
5. When the CI-checks rule (`pr-ci`) lands, should a merged PR move the ticket to Done (Spark never closes tickets today)?
6. Should the brief's numbered items stay in the feed too (so the list is complete when the brief fails), or be hidden from the feed while the brief is fresh?
7. When all is quiet and there's nothing to pick up, should the "What needs you today" section disappear completely, or keep a one-line "Nothing needs you"?
8. Should Up next show on Home at all, or only in Tickets, to keep Home shorter?
9. A brief written when Home opens before the Tickets inbox has refreshed the flagged set only sees the previous snapshot; a dedicated `GET /attention` endpoint shared by both screens would fix that skew, but doesn't exist yet.

## Keyboard and accessibility

- Every control is a native button, select, input or checkbox with a visible label or `aria-label`. Focus rings use the mockup's `:focus-visible` style.
- Rows are list items with a main button (`aria-current` when selected) and a separate action button, named with the key ("Start API-84"). The action shows on `:focus-within` and on the selected row, so keyboard users see it. Up and Down (J and K in the mockup) move the selection.
- Keys for the build: `/` focuses search, Escape clears it, Up and Down move the selection, Enter opens the detail, `S` opens Start work, `A` assigns to me. Escape closes the confirm, the popover and the dialog and returns focus to where it was.
- Section headers hold a disclosure button (`aria-expanded`, `aria-controls`) and a separate info button. Views in the side column are toggle buttons (`aria-pressed`). Density and theme are radio groups.
- Reasons are text, never color alone: the severity dot is decorative (`aria-hidden`). `+N` and the sync glyph carry their full text as hidden text and a `title`. Section info tooltips use `role="tooltip"` and `aria-describedby`, open on hover and focus, and close with Escape (WCAG 1.4.13).
- The assign confirm is a non-modal dialog labelled by its question. The Start dialog and Settings are modal dialogs (the build needs a focus trap and focus return). The brief settings popover is a labelled dialog with a real switch.
- Loading regions carry `aria-busy` and a hidden status line; skeletons are `aria-hidden`. Search results announce their count. Toasts use a polite live region; banners and inline errors use `role="alert"`.
- axe (WCAG 2.0, 2.1 and 2.2 A and AA tags) reports no violations in any listed state of either mockup, in light and dark. The click-through covers sections, views, density, filters, brief refresh, brief settings and the off switch, `/` search, the search skeleton, assign, undo, the confirm with Escape, the Jira assign error, Start from a quick action with focus return, Start on an unassigned ticket with the assign checkbox, Retry, Settings, the token-rejected disabled states, and the Home feed filter, brief off and on, and "since you were away".
- Motion follows the mockup, including `prefers-reduced-motion`. Skeleton shimmer stops under reduced motion.
