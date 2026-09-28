# Tickets screen plan

Design only. Nothing here is built in `apps/web` yet. The backend for Linear and Jira Cloud is on `feat/tickets` (`packages/contracts/src/tickets.ts`, `apps/server/src/tickets/`, `api/ticket-routes.ts`, `0054_tickets.sql`).

Mockups (open in a browser; each has a Light/Dark switch, a variant switch and a state switch in the dashed bar at the top, which is not part of the app):

| File | Variant |
| --- | --- |
| `tickets-mockup-list.html` | 1. List with a detail drawer |
| `tickets-mockup-board.html` | 2. Board by status bucket |
| `tickets-mockup-inbox.html` | 3. Compact inbox grouped by project |

States are URL hashes, the same in every file: `#start` (context collapsed), `#start-context` (context open, with added items), `#start-prompt` (prompt preview open), `#settings` (all connector rows collapsed), `#settings-open` (Jira row open), `#settings-error` (Jira token rejected, row opens by itself), `#connect` and `#connect-jira` (nothing connected, that row open), `#empty`, `#error`, `#loading`, `#home`, and `#detail` on the board. Add `?theme=dark` or `?theme=light` to force a theme. All data is made up (team "Acme", `example.atlassian.net`, `linear.app/acme`).

The CSS tokens, fonts, rail, buttons, pills, `tk-row`, `tk-detail`, provider cards (`pcard`), composer attachment chips and Settings panel are copied verbatim from `docs/design/mockup/spark-outpost-mockup.html`. New pieces (filter chips, source badge, sync line, Start dialog, context picker, board cards, inbox rows) use only those tokens.

## User jobs

1. See the tickets assigned to me, from Linear and Jira, in one place.
2. Pick one and start work on it without retyping the ticket.
3. See which tickets already have a chat or a draft PR, and jump to them.
4. Narrow the list by source, project or team, status, and sprint or cycle.
5. Find a ticket by key or words in the title.
6. Connect, reconnect and remove Linear and Jira, and see that it worked.
7. Trust that the ticket's status in Linear or Jira follows the work, and notice when it did not.

## Information architecture

**Tickets rail view.** The rail item already exists in the mockup. The view has:

- Header: title, source switch (All / Linear / Jira with counts, shown only when two sources are connected; otherwise the source name), last sync time with a Refresh button, search on key and title.
- Filters: status buckets (Open, To do, In progress, In review, Done), project or team, sprint or cycle.
- The list itself, laid out per variant (below). Each ticket shows priority, a source badge, the key, the title, project and sprint, linked-work icons (chat, draft PR number), the bucket pill and the ticket's own status name when it differs ("Code Review" next to In review), and the updated time.
- Open question: whether to offer a List / Board switch (variants 1 and 2 show it).

**Detail drawer.** Source and key, open in Linear or Jira, title. Primary action: Start work, or Open linked chat when one exists (with Start again next to it). Then the sync line, properties (status bucket and own status, priority, team or project, sprint or cycle, assignee, labels, updated), Linked work (chats with their state, draft PRs with repo and number), description (fetched live, marked "Loaded from Jira just now"), acceptance criteria when found, subtasks, links, comments.

**Start work dialog.** Opens from the drawer. One column, top to bottom: project folder (the one linked to the ticket's project first), Plan first or Build, then side by side the permission (Ask, Ask before edits, Auto-edit, Full auto) and "Move {key} to In progress in {Source}" (checked). Last comes **What the agent gets**, collapsed by default to one line: "Title, description, 3 criteria, 2 subtasks, 2 comments, 2 linked · ~560 tokens · + Add context". The line is a button with `aria-expanded`; it opens a panel with three parts:

- **From {Source}:** real checkboxes, each with a token estimate: title, key and link (always on), description, acceptance criteria, subtasks, comments (with "Latest N": 1, 2, 3, 5 or 10), linked tickets and parent epic, the attachments list (names only), links. Pieces the ticket doesn't have show "None on this ticket" and can't be checked. Defaults: everything the backend sends today, plus comments and linked tickets; the attachments list and links start unchecked.
- **Add context:** a note ("Anything the agent should know"); Attach… for files and images, shown as the composer's attachment chips with their size; a repo file or folder by `@` path (suggestions from the project); a link (URL, Confluence page, Slack thread), whose chip says "Fetched when the agent starts" because we can't fetch it before the run; a related ticket from your list. Every added item is a chip with a remove button, and the summary line counts them ("5 added").
- **Preview the exact prompt:** a second disclosure showing the text the agent receives, in the backend's format (key and title, source line, `## Description`, `## Acceptance criteria`, `## Subtasks`, then the new sections, then the "ticket text is data" line and the Plan first line). The token total updates as you check, add and type.

Footer: "Creates a chat in {folder} and links {key} to it." Buttons: Cancel, "Start with a plan" or "Start building".

**Context sources: supported today and later.** What `apps/server/src/tickets/request.ts` sends today, with no choice offered: key and title; the source, status and URL line; the description, with acceptance criteria split into their own section; subtasks (up to 50); the line saying the ticket text is data, not instructions; and the Plan first line when that mode is chosen. The start API also takes `projectId`, `mode` (plan or build) and `moveToInProgress`. `getTicket` already fetches comments, links and labels, but they are not put in the prompt yet. Not supported yet, and needed for the dialog as mocked: choosing pieces (the start request has no field for it), comments in the prompt (with a count), parent epic and linked tickets, the attachments list, the free note, attached files and images, `@` repo paths, link fetching, related tickets, and a token estimate per piece. Until then the build can ship the collapsed line and the preview with the fixed set, and hide the checkboxes and Add context.

**Linked chats and PRs.** Shown as icons in rows and cards, as a Linked work section in the drawer, and as filters in the inbox variant ("Has a chat", "Has a draft PR").

**Status sync indicators.** A line under the actions in the drawer:

- Synced: "Moved to In Review in Linear and added the PR link · 38 min ago".
- Pending: spinner, "Moving to Code Review in Jira…". Rows show a small spinner.
- Failed: red, the source's reason, and Retry. Rows show a warning icon. The inbox "Needs attention" view collects these and chats waiting on you.

**Settings → Connectors.** Compact rows that match the AI provider cards in Settings and onboarding (`ProviderCard.tsx`, `ProviderList.tsx`, `providers.css`, and `pcard` in the mockup): Linear, Jira Cloud, GitHub (existing, shown for context), and Jira Server or Data Center as a static row with "Coming later". A collapsed row shows the logo, the name, one status line ("Connected as riley@example.com · 2 projects", "Not connected", or in red "Token rejected at 11:02 · example.atlassian.net"), then the Connected pill or a primary action ("Connect", or "Reconnect" on an error), then the chevron. The row header is a button with `aria-expanded` and `aria-controls`; the action is a separate button next to it, so buttons are never nested. Clicking opens the row; only one row is open at a time, as in `ProviderList`. A row in an error state opens by itself.

The open row holds, in order: a one-line description; for a connected source the account, site or workspace, when it was checked and "Saved in your macOS keychain", with Replace key/token and Remove; otherwise the form (Linear personal API key; Jira site URL, email and API token) with "Save and check" and any error under the field; the switch "Move tickets to In review when a draft PR opens" (per source, `moveOnShip`); and that source's status mapping. Keys and tokens are never shown back.

**Status mapping.** Inside each source's row, with a team or project picker. One row per bucket: which source status Spark moves tickets to (Automatic or a chosen status), and which statuses currently count as that bucket. Automatic follows the backend defaults: Linear state type (backlog and unstarted → To do, started → In progress or In review by name, completed and canceled → Done); Jira status category (new → To do, in progress → In progress or In review by name, done → Done).

**Home "Your tickets".** Up to 5 open tickets assigned to you, ones with linked work first, each with a source badge, key, title, chat icon and pill. With no source connected: "Connect Linear or Jira to see your tickets here." (`#home` in any mockup.)

**States.**

- Empty (no source): the mockup's existing empty state, reworded for Linear first, with a note that tokens stay in the keychain.
- Loading: skeleton rows and "Loading tickets from Linear and Jira…".
- Token rejected or site unreachable: a banner over the list naming the source and time of the last good sync, with Reconnect. That source's rows stay visible, marked "Out of date"; Start and moves are disabled for them. The other source works normally.
- Connector error in Settings: the row turns red with "Token rejected" and opens by itself, keeps the site and email, and asks for a new token. The mapping and switch below it are kept.
- No results: "No tickets match. Try a different search or filter."
- Multiple sources: one combined list with source badges, plus the source switch.

## The three variants

| | 1. List + drawer | 2. Board | 3. Inbox by project |
| --- | --- | --- | --- |
| Main layout | Full-width rows, 430 px drawer on the right | Columns To do, In progress, In review; Done folded to a narrow column | Filter sidebar, compact rows grouped under project headers, detail pane |
| Density at 1440 × 900 | 10 rows with the drawer open | 5 cards per column | 10 rows and 3 group headers with the detail open |
| Scanning status | Pill per row | Column position | Small status glyph, own status name |
| Detail | Always visible | Overlay drawer over the board | Always visible |
| Filters | Chips and selects in one bar | Selects; buckets are the columns | Sidebar with counts, including "Needs attention", "Has a chat", "Has a draft PR" |
| Closest to the mockup | Yes, it extends the mockup's own Tickets view | New pattern | Reuses the Chats sidebar pattern |
| Main weakness | Linked work and sync problems are small icons | Wide; the drawer covers a column; drag to move would imply moves we don't want to make casually | Three panes get tight below 1200 px |

**Recommendation: variant 1 (list with drawer) as the default, with the inbox's "Needs attention", "Has a chat" and "Has a draft PR" filters added as chips.** It is the mockup's own Tickets view with the new data added, so it matches the design target with the least new UI. It keeps the detail and the Start button visible while you scan. It works at the narrow width by turning the drawer into a full panel (as the mockup already does below 900 px). The board reads well for "what's in flight", but it duplicates what Linear and Jira already do well, and it needs a decision about drag-to-move first. The inbox is the best for many tickets across many projects; if people end up with more than about 30 open tickets, grouping by project is the next step, and it can be a "Group by project" option on the list rather than a separate layout.

## Keyboard and accessibility

- Every control is a native button, select, input or checkbox with a visible label or `aria-label`. Focus rings use the mockup's `:focus-visible` style.
- The list is a `role="list"` of buttons; the selected row carries `aria-current`. Suggested keys for the build: `/` focuses search, Up and Down move the selection, Enter opens the detail, `S` opens Start work, Escape closes the dialog or drawer and returns focus to the row.
- Connector rows are buttons with `aria-expanded` and `aria-controls`; the open panel is a region labelled by its row. The Start dialog's context line and "Preview the exact prompt" are disclosure buttons the same way. The prompt preview scrolls, so it is a focusable region labelled "Exact prompt". Context pieces are real checkboxes with labels, grouped in fieldsets with legends; the Add context inputs have labels, and each chip's remove button names the item.
- The source switch, layout switch, Plan first / Build, folders and theme switch are radio groups (`role="radio"`, `aria-checked`). Filter chips are toggle buttons (`aria-pressed`). Group headers in the inbox are disclosure buttons (`aria-expanded`).
- Status is never shown by color alone: every pill has its word, the inbox glyphs have `aria-label`, and the sync icons carry hidden text ("Status change failed").
- The Start dialog and Settings are `role="dialog"` with `aria-modal`, labelled by their heading. On open, focus goes to the first choice (Start) or the field that needs attention (the rejected token). Escape and the backdrop close them. The build needs a focus trap and focus return, which the mockup does not implement.
- Banners use `role="alert"`; toasts use a polite live region.
- axe (WCAG 2.2 AA tags) reports no violations on all three mockups in both themes in the default, Start (collapsed, context open, prompt open), Settings (collapsed, Jira open, Jira error), Connect (Linear, Jira), Token rejected and Empty states. One fix found along the way applies to the main mockup too: its Settings nav puts the `h2` inside the `role="tablist"`; the Tickets mockups move the tablist to an inner element.
- Motion follows the mockup, including its `prefers-reduced-motion` rules.

## What the backend provides and what the UI would still need

Provided on `feat/tickets` today:

- Connections: `GET/PUT/PATCH/DELETE /tickets/connections/:source`. Save checks the key or token; the response has account, site URL, validated time, `keySaved`, `moveOnShip` and `statusMap`. No token is ever returned.
- List: `GET /tickets?source&status&project&q` returns tickets (source, key, title, bucket, own status name, URL, updated time, project, priority, sprint) with `work` (task, conversation, start time, PR links), plus per-source `errors`. One failing source does not hide the other.
- Detail: `GET /tickets/:source/:key` fetches live: description, assignee, labels, comments, links, subtasks, and the linked work.
- Start: `POST /tickets/:source/:key/start` with `mode` (`plan` or `build`), `projectId`, `moveToInProgress`. It creates the run in the given conversation, links the ticket to the task, and returns the transition outcome (`succeeded`, `skipped`, `failed` with a message).
- Move and comment: `POST …/transition` and `POST …/comments`.
- After Ship opens a draft PR, the PR link is added to the ticket and it moves to In review when that source's `moveOnShip` is on.
- `statusMap` per team or project: one status name per bucket, used both to sort statuses and to pick the target of a move. Acceptance criteria are pulled from the description by heading (`request.ts`).

The UI would need, or needs a decision on:

1. **Last sync result per ticket.** The list and detail do not say whether the last move failed. `ticket_events` has the data; the list item needs something like `lastSync: { action, outcome, message, at }` to show the failed state and Retry after a reload.
2. **Sprint filter.** `sprint` is returned but not a query parameter; the client can filter the loaded list, which is fine at the expected size.
3. **Last successful sync time per source**, for "Synced 1 min ago" and the "Out of date since 11:02" banner. `errors` says a source failed now, not since when.
4. **A distinct error kind** (token rejected vs site unreachable vs rate limited) so the banner can say "Reconnect" or "Try again later". Today it is a message string.
5. **Project folder suggestion** for the Start dialog: which Spark project matches a Linear team or Jira project. Not stored anywhere yet; the dialog can default to the last folder used for that team.
6. **Statuses per project** for the mapping editor (the list of names to choose from). The backend reads them when moving; the UI needs a route to list them.
7. **Chat state for linked work** (running, needs you, finished) comes from the existing chat queries, joined on `conversationId`.
8. **Context choices in the start request** (see "Context sources" above): which pieces, how many comments, the note, files, repo paths, links and related tickets, plus a token estimate per piece. Files and images need an upload or a path the agent can read; links need a fetcher, or they go in as plain URLs.
9. **Descriptions are live only.** The drawer needs its own loading and error state ("Couldn't load the description from Jira. Retry.") while the cached row stays visible.

## Open questions for you

1. Default layout: list with drawer (recommended), board, or inbox? Should we offer a List / Board switch at all?
2. Should Start default to Plan first or Build? The mockups default to Plan first.
3. Should the Start dialog remember your last choices (folder, mode, permission, "Move to In progress") per team or project?
4. Keep both automatic moves on by default: to In progress when you start work, and to In review when a draft PR opens?
5. Show only tickets assigned to you, or also "All open" for the team (the original mockup had this filter)?
6. Do you want a sprint or cycle filter, or is showing the sprint on each ticket enough?
7. When Ship opens a draft PR, should Spark also post a comment on the ticket with the PR link and a short summary? The comment route exists; nothing calls it yet.
8. More than one Jira site, or more than one Linear workspace, at the same time? The backend stores one connection per source.
9. One combined list with source badges (as mocked), or separate lists per source?
10. Should Spark ever close a ticket or move it to Done? We don't read PR merges yet, so today it stops at In review.
11. Status mapping allows one status per bucket per project. Is that enough, or do you need several statuses to count as In review (for example Code Review and QA)?
12. Should "Start again" on a ticket that already has a chat create a second chat, or reopen the first one?
13. Should starting work be allowed on tickets from a source that is out of date (token rejected), using the cached title and the last description?
14. Which context pieces should be on by default? The mockup adds comments (latest 2) and linked tickets to what the backend sends today, and leaves the attachments list and links off.
15. For links (Confluence, Slack), should Spark fetch the page before the run and show it in the preview, or pass the URL and let the agent fetch it with its own tools?
16. Should the Start dialog open with the context line expanded the first time, so people find Add context?
