# Home integration plan

Design only, September 28, 2026. This plan fits the planned brief and "Needs you" feed (`docs/design/tickets/TICKETS_SCREEN_PLAN.md`) into the Home that ships today (`apps/web/src/home/`). The rule is to keep what works and merge anything that would otherwise show up twice.

**Mockup:** `docs/design/tickets/home-brief-mockup.html` is now the integrated Home. It uses sample data. States (URL hash): default, `#tickets` (ticket slice), `#all-quiet`, `#quiet-bare`, `#no-tickets`, `#writing`, `#failed`, `#off`, `#settings`, `#no-ai`, `#loading` and `#narrow` (three 390 px frames). `?theme=light|dark` forces the theme. The Home, composer, provider strip, digest and spend CSS comes from the app files named at the top of its additions block. Provider mascots use the bundled blobatar, as in `docs/design/mockup/`.

**Checks:** axe (WCAG 2.0, 2.1 and 2.2, A and AA) finds 0 violations in all 12 states, in light and dark, at 1440 px and 390 px, plus once more with a row action showing. A 30-step click-through passes. It covers the filter chips, arrow keys between rows, row actions on focus, brief settings with Escape and focus return, turning the brief off and on, Refresh, "since you were away", Continue, the summary link to the feed, starting a chat, and dismissing the connect hint. It also checks the quiet, no-AI and loading states and the theme switch.

## The Home today (inventory)

In page order. Screenshots from the dev app (light, dark, 390 px) are in the session scratchpad as `home-current-*.png`. They were taken read-only: every non-GET request was blocked.

| # | Element | Purpose | Data source |
| --- | --- | --- | --- |
| 1 | Greeting (`Home.tsx`), Blob Scout 54 px, "Good afternoon, Subash" | Welcome; the mascot's mood reflects the app | `GET /setup` (`profile.displayName`), local clock |
| 2 | Summary line (`summaryParts`) | "N agents are working and N chats need your input", or "All quiet. Start something new below." | Conversations list (`chats` prop, `GET /conversations`) |
| 3 | Provider strip (`ProviderStrip.tsx`) | One mascot per provider or advisor, with a status mark (connected, problem, off), a tooltip with the model, a warning pill with Fix. Opens Settings, AI | `GET /setup`, `GET /providers/health`, capabilities per provider |
| 4 | Quick-start composer (`HomeComposer.tsx`) | Starts a chat in the background: project bar, model and effort picker, attachments, context ring. Shows "Started '…' · Open" | Draft conversation, `sendMessage`, `updateChatSettings`, attachments |
| 5 | "All quiet" dashed panel | Shown when nothing needs you and nothing runs | Derived from 6 and 7 |
| 6 | Needs you (`HomeCards.tsx`, `needsYou`) | Big cards for chats that are asking, stopped with an error, or finished and not opened. Answer, See error, Review | Conversations (`rowState`, `attention`) |
| 7 | Running now (`runningNow`) | Big cards with the current step and a plan progress bar. Watch. Sits next to 6 in two columns at 1000 px and wider | Conversations (`latestRun.step`, `progress`) |
| 8 | Digest card (`DigestCard.tsx`) | An AI summary of recent chats. It has a meta line (time · model · cost), Audit, a headline, stat chips ("1 done", "$0.10") that scroll to sections, Show/Hide details (saved locally), lines linking to chats, "Pick up where you left off" suggestions with Continue (which queues a drafted message), "Nothing new since this digest", a writing skeleton, and an error with Retry or a wait hint | `GET /home/digest`, `POST /home/digest {trigger: open\|refresh}`. The server job (`apps/server/src/digest/`) uses `digestModel` (middle tier) and `decideDigest` (10 min minimum gap, automatic on open after 60 min, skipped when nothing is new, 24 h to 7 day window) and records cost and model |
| 9 | Recent chats | The 5 most recent chats not already shown in 6 or 7. View all | Conversations |
| 10 | Spend (`SpendCard.tsx`) | Today or This week total, runs and tokens, cost bar and legend by provider, "Open usage and audit" | `GET /usage/spend?range&tz` |

What I saw on the live app:

- **The AI and the rules disagree.** The panel says "All quiet. Nothing needs you", but the digest headline right under it says a chat "is waiting on you to pick a direction". The chat asked a question in plain text, so no rule flagged it, and the digest is also older than the live state. The integrated brief only summarises rule-flagged items, so it can't contradict the list.
- **"All quiet" appears twice**, once in the summary line and once in the dashed panel.
- **The stat chips repeat other parts of the page.** "$0.10" repeats Spend, and "N needs you" repeats the Needs you section.
- **While the digest query loads, the meta line says "Nothing new since your last digest."** `digestView` returns `loading` and the card falls through to the quiet text. This is a small bug to fix during the build.

## The integrated Home

Top to bottom. The page is 860 px wide and one column, apart from Up next and Recent chats.

1. **Greeting, summary line and provider strip: kept.** The summary counts every flagged item (chats, tickets and PRs), not just chats: "7 things need you and 2 agents are working". "7 things need you" links to the feed and focuses its first row.
2. **Quick-start composer: kept unchanged, in the same place.** Starting work is still the first action on the page.
3. **"What needs you today": one section, replacing Needs you, the All quiet panel and the Digest card.** Header: the title, the flagged count, Refresh and the brief settings gear. Body:
   - **Brief panel** (the Digest card, grown). It keeps the scout head, the meta line ("Generated 09:12 · Sonnet 5 · ~$0.01 · from 7 flagged"), Audit, the headline, the writing skeleton, the failure text with Retry or a wait hint, and the throttling. The digest's continue suggestions become the brief's **numbered items (up to 3)**: title (with the ticket key when there is one), one sentence, and one button. A button reads **Continue** when a draft is ready (it queues the draft in the chat, or pre-fills the Start dialog for a ticket) and **Answer** when a chat is asking. The digest's lines move into a **"Show what happened since you were away (N)" disclosure**, closed by default (the existing details-open key keeps its meaning). The stat chips are removed.
   - **Needs you feed.** One bordered list of lean one-line rows for chats, tickets and PRs, with the same row as the Tickets inbox: priority (or the provider mascot for a chat), key, title, one reason, +N, a sync glyph, age, and one ghost action on hover or focus. Filter chips (All, Chats, Tickets, PRs, with counts) appear only when more than one kind is present. The sort rule is in an info tooltip. A ticket and its linked chat are one row, shown as the ticket.
4. **Running now: kept as the big cards with progress, full width and below the feed.** When a running chat is linked to a ticket, the card leads with the key ("WEB-421 Filter chips overflow the toolbar"). The section is hidden when nothing runs.
5. **Up next | Recent chats: two columns.** Up next is the top 4 tickets from the inbox's Up next view, with a link to Tickets. Recent chats is unchanged (5 chats not already shown above). With no ticket source, Recent chats takes the full width.
6. **Spend: kept, last, in the quieter secondary style.**

### Before → after

| Before | After | Why |
| --- | --- | --- |
| Greeting + Scout | **Kept** | Works; it sets the tone |
| Summary line (chats only) | **Kept, widened** to all flagged items; the count links to the feed | One number that matches the feed and the rail badges |
| Provider strip | **Kept** | Provider health belongs at the top |
| Quick-start composer | **Kept** | The main action; reuses the chat composer |
| "All quiet" dashed panel | **Removed** (merged) | The summary line already says "All quiet". When the brief has things to pick up, they take the section's place |
| Needs you (big cards, chats only) | **Merged** into the Needs you feed as lean rows | One list for chats, tickets and PRs. Big cards don't scale to 7 or more items and would repeat the inbox |
| Needs you placeholder "Nothing needs you right now" | **Removed** | Empty sections collapse |
| Running now (paired column at 1000 px and wider) | **Kept, moved** below the feed, full width; hidden when empty; shows the ticket key | The feed's rows need the full width. Running is live status, not a to-do |
| "No agents running" placeholder | **Removed** | Collapses |
| Digest card | **Merged** into the brief panel inside "What needs you today" | One AI card and one model call. Its job, audit, cost and throttle carry over |
| Digest headline | **Kept** as the brief headline, written from flagged items and recent activity | Same slot, better input |
| Digest stat chips | **Removed** | They repeated the feed's counts and Spend |
| Digest Show/Hide details + lines | **Moved** into "Show what happened since you were away (N)" | Useful but secondary; closed by default |
| Digest continue suggestions | **Kept and widened** into the brief's numbered items (up to 3), which may point at tickets | The part of the digest people act on |
| "Nothing new since this digest" | **Moved** into the meta line | One line fewer |
| Recent chats | **Kept**, next to Up next | Unchanged logic; it excludes chats shown above |
| (none) Up next | **New** | Planned in the tickets plan; replaces the design mockup's "Your tickets" |
| Spend | **Kept** | Unchanged |

### States

- **All quiet** (nothing flagged, nothing running): the summary says "All quiet. Start something new below." The feed and Running now are hidden. If the last brief has chats to pick up, the section is titled **"Pick up where you left off"** and holds only those items and "since you were away" (the meta line says "Nothing is flagged"). If there is nothing to pick up, the whole section is gone (`#quiet-bare`). No dashed panel.
- **No ticket source**: the feed holds chats only, without filter chips. Up next is hidden and Recent chats takes the full width. No empty ticket sections anywhere. The only mention is one muted footer line under the feed: "Tickets and pull requests from Linear or Jira can show here too. Connect ×". Dismissing it hides it for good in this browser (Settings, Connectors is still there). The line never shows in the all quiet state.
- **Brief writing**: the scout works, the meta says "Reading 7 flagged items and your recent chats…", with a three-line skeleton. Refresh reads "Writing…" and is disabled. The feed is fully usable.
- **Brief failed**: the last brief's time and model, the provider's reason, "Nothing was charged", "The list below is complete; only the summary is missing", and Retry (or "You can refresh in N min").
- **Brief off**: the panel shrinks to one line, "The brief is off. Rules still sort the list below. Turn on (about $0.01 each)". Refresh is disabled and the gear stays.
- **No AI provider** (`available: false` today): no panel, no Refresh and no gear. The feed stands alone.
- **Loading**: skeletons shaped like each part (summary line, 4 provider dots, brief panel, 4 lean rows, one Running card, list rows, spend panel). The composer renders at once. `aria-busy` on the live area and a hidden status line. No spinners.
- **Narrow (under 640 px)**: the rail becomes the bottom bar. Rows take two lines (the reason moves under the title) and the action sits bottom-right. Filter chips scroll sideways. Brief item buttons drop under their text. Up next and Recent stack. The settings popover docks above the bottom bar.

### Running now vs "Working on" tickets

Running now is only for work that is executing right now: chats with a queued or running run. A running chat linked to a ticket shows the ticket key on its card and doesn't also appear in the feed, unless it's asking, in which case it moves to the feed and leaves Running. The inbox's other Working on cases ("Finished, not shipped", "In progress · no chat") are not live, so they stay in the Tickets inbox. They reach Home only if a rule flags them (for example, a finished chat you haven't opened). So every item shows in exactly one place on Home: the feed (needs you), Running now (busy), Up next (queued) or Recent chats (everything else).

## Data each part needs

| Part | Exists today | New |
| --- | --- | --- |
| Greeting, provider strip, composer, Recent chats, Spend | All the calls in the inventory | Nothing |
| Summary counts, rail badges | Conversations | Count from the attention feed once tickets are in it |
| Needs you feed, chats only | `needsYou(chats)` (asking, error, done) | Lean row component; rule wording and ages come from `rowState` and `attention` |
| Needs you feed, tickets and PRs | `GET /tickets` (with `work` links), `GET /tickets/connections`, PR URL in `task_links` | Attention rules module and `GET /attention` (tickets plan, "Data each view needs"). Ticket summary fields (assignee, due date, priority rank, `first_seen_assigned_at`, `status_since`, `lastSync`). Chat state joined on `conversationId`. PR status reader later |
| Up next | `GET /tickets` | The same summary fields for sorting |
| No-ticket-source state | `GET /tickets/connections` | Local "hint dismissed" flag (per viewer, local storage) |
| Brief panel | The digest job, `GET/POST /home/digest`, audit, cost, `refreshableAt`, `newActivity` | Input adds the flagged items (metadata only). Output adds `items: [{ ref: {kind, id}, text, verb, draft? }]` (up to 3, validated against the input), replacing `suggestions` (chat-only today). Keep `headline` and `lines`. `DigestState` adds `enabled`, `intervalMinutes`, `flaggedCount` and `monthCostUsd`. Skip the call when the flagged-set hash and activity haven't changed. Settings for on/off and the interval |
| Continue on a ticket | `queueDraft` for chats | Start dialog accepts a pre-filled note from the brief |

## Build order

1. **Chats-only restructure (no backend).** Build one "What needs you today" section. Move the Digest card into it and remove its stat chips. Add the lean feed rows fed by `needsYou(chats)`. Make Running now full width and hide it when empty. Remove the dashed All quiet panel and the empty placeholders. Add the "since you were away" disclosure. Fix the loading meta text and add skeletons. This ships on its own and removes today's duplication.
2. **Attention rules and `GET /attention`** for chats (same output as step 1). Rail badges and the summary line read from it.
3. **Tickets in the feed**: summary fields, linked-chat join, filter chips, Up next, the no-source footer line, ticket keys on Running cards. This lands together with the Tickets inbox's Needs attention section.
4. **Brief**: flagged-item input, `items` with drafts (chat and ticket), the settings popover (on/off, interval), the hash throttle, and month cost.
5. **PRs**: rows from `task_links` now. The `review-slow`, `pr-changes` and `pr-ci` rules come after the PR status reader.
6. **Tickets inbox brief strip** reads the same brief (no model call of its own).

## Open questions

1. Should the brief's numbered items stay in the feed too (as mocked, so the list is complete when the brief fails), or be hidden from the feed while the brief is fresh?
2. Automatic brief interval: keep today's digest default (at most hourly on open), or use the tickets plan's 30 minutes?
3. When all is quiet and there's nothing to pick up, should the section disappear completely (mocked) or keep a one-line "Nothing needs you"?
4. Should Up next show on Home at all, or only in Tickets, to keep Home shorter?
5. Should dismissing "Connect Linear or Jira" be stored per account (server) rather than per browser?
