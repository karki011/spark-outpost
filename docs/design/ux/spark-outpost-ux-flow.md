# Spark Outpost: UX flow and interaction spec

This document covers the design rules that stay true across screens: principles, glossary, the app shell (rail, Blob Scout, theme, toasts), mascots, motion, keyboard and accessibility, and copy rules. It no longer specs individual screens (onboarding, Home, Chats, Tickets, Settings) — those are built; read the code and `docs/design/mockup/spark-outpost-mockup.html` for current behavior. Where the mockup fakes something (verification, agent runs, OAuth), the real product differs; see `docs/product/PLAN.md`.

Mockup: `docs/design/mockup/spark-outpost-mockup.html`
Tickets and Home-brief mockups: `docs/design/tickets/` (see `docs/design/tickets/TICKETS_SCREEN_PLAN.md`)

---

## 1. Principles

These rules decide every open question in this document.

1. **Quiet by default, complete on demand.** Every reply shows what happened, what changed, and what to do next. Detail sits one tap away and is never removed.
2. **Status has one language.** A chat's state (running, needs input, done, error) looks the same in the sidebar, on Home, in the rail badge, on the mascot, and in the browser tab.
3. **Motion answers the user.** Animation confirms an action or shows progress. The only ambient motion is the mascots idling.
4. **Errors say what happened and how to fix it.** No apologies, no vague "something went wrong."
5. **Personality lives in the mascots.** The chrome stays calm so Blob Scout and the provider blobs can carry the character.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| Provider | An AI backend. Claude (Anthropic), Codex (OpenAI), and Z.ai. At least one must be connected. |
| Connector | An optional tool integration: Jira, GitHub, Linear, Slack. |
| Project | A folder of chats tied to a codebase. Chats can live in a project or in the loose "Chats" list. |
| Chat | One conversation with one agent run history. Has a status, a context window, and a provider. |
| Run | One agent turn: steps, then a reply, then optional next actions. |
| Blob Scout | The app logo and mascot. Its mood reflects the whole app. |
| Provider blob | Each provider's mascot. Its mood reflects one run. |
| User blob | The user's avatar, generated from their name. |

---

## 3. App shell

### 3.1 Layout

| Width | Layout |
|---|---|
| Over 1000 px | Rail (70 px) · Chat sidebar (268 px, Chats view only) · Main panel |
| 641–1000 px | Same, sidebar narrows to 232 px |
| 640 px and below | Bottom tab bar replaces the rail. Chat sidebar becomes a drawer. |

The main panel is a raised card with rounded corners; on phones it goes edge to edge.

Inside a chat's main panel:

| Part | Rule |
|---|---|
| Top bar | The header row is its own surface (`--panel`) over the full panel width, above the thread and the context rail, with a `--line` hairline under it. Height and controls as in the mockup. |
| Chat column | One reading column, 880 px wide where the panel has room (about 120 characters at 15 px), centred in the space left of the context rail, with 56 px gutters (narrowing to 16 px as the panel drops from 592 to 512 px). It narrows with the panel below that room. Replies, the run header, step rows, cards, the user's bubbles, the footer row and the composer stack share its two edges. |
| Prose | Paragraphs, lists and headings use the full column. The user bubble is right-aligned to the column's edge and stops at 82% of it. Code, tables, diffs and cards use the full column and scroll sideways inside it. Table header words never break mid-word. |
| Reply indent | Below an agent's header row, everything in its turn (prose, step rows, tables, code, cards, result line, footer row) starts at the agent name's x-position: avatar width plus the header gap (`--turn-avatar` + `--turn-gap`, 38 px). The right edge stays the column's. Applies to solo turns and crew agent blocks; headers, user bubbles and the composer stack do not move. Flush on phones. |
| Tick rail | One tick per user message in the left gutter, 48 px left of the column, centred on the thread. The tick in view is longest, two neighbours taper. Hover, focus or tap shows a preview card. Shown from three messages, hidden when the thread is under 600 px wide and on phones. Replaces the "On this chat" list of the context rail. |
| Context rail | With the work panel closed on wide windows: a strip anchored to the panel's right edge, 216–320 px of content by panel width, tinted `--bg` with a `--line` divider. The crew stage scales with it. |
| Pull request row | One line per pull request in the composer stack, above the context bar and as wide as the composer: chevron and PR icon, `#number` link, title (truncates first), the facts that matter, then the state at the right in a status colour (Open `--success`, Draft `--muted`, Merged `--accent-text` on an accent-tinted row, Closed `--danger`). Fixed height, 32 px (44 px on phones), so live updates never move the composer. Click, Enter or Space opens a panel upward over the thread, at most 56% of the window height; Escape or a click outside closes it. Merged and closed rows carry ×. More than two pull requests collapse to "N pull requests". Nothing about a pull request sits in the top bar or above the thread. |
| Crew notes | Consecutive paragraphs in a crew member's block sit 0.55 em apart; replies elsewhere keep 0.8 em. |

### 3.2 Rail

| Item | Behavior |
|---|---|
| Blob Scout (top) | See 3.3. |
| Home, Chats, Tickets | Switch views. The active item gets a raised background with an accent bar that slides between items (spring, 500 ms); its icon turns accent. Hover lifts the icon 2 px; press scales it down. |
| Chats badge | Amber count of chats that need input. Pops in when it appears; hidden at zero. |
| Settings | Opens Settings at Profile. The gear rotates 60° on hover. |
| Avatar (user blob) | Opens Settings at Profile. Scales up slightly on hover. |

**View switch:** the new view fades up 8 px (450 ms). Open menus and popovers close. The choice is saved.

**Phone tab bar:** Home, Chats, Tickets, Settings, each with icon and label. The active tab gets an accent bar on top that pops in. Content is padded so nothing sits under the bar.

### 3.3 Blob Scout (logo mascot)

Always: breathes, blinks every ~5 s, the antenna spark twinkles, and the eyes follow the pointer (up to about 3 units of travel, smoothed). Uses the theme accent (body) and warn color (spark), so it recolors with the theme.

**App-wide mood** (rail, Home greeting, favicon):

| Priority | Condition | Mood |
|---|---|---|
| 1 | A run just finished (2.6 s window) | Happy: arc eyes, cheeks, hops twice, sparks burst from the rail |
| 2 | Any chat needs input | Alert: antenna wiggles, spark pulses, eyes wide |
| 3 | Any agent running | Working: spark spins and glows, eyes scan side to side |
| 4 | Otherwise | Idle |

**Tap Blob Scout (desktop):** squish animation, small spark burst, and a speech bubble beside it for 4.5 s.

| State | Bubble text | Tapping the bubble |
|---|---|---|
| One chat needs input | "{Chat} needs your input. Tap to answer." | Opens that chat |
| Several need input | "{n} chats need your input. Tap to see them." | Opens Home |
| Agents running | "{n} agents are working. I'll let you know when they're done." | Opens Home |
| Nothing going on | One of: "Hi {name}. All quiet out here." / "Nothing needs you right now, {name}." / "Scouting done. No news is good news." | Dismisses |

**Unprompted bubble:** when a chat the user isn't viewing starts asking a question: "{Chat} has a question for you. Tap to answer." Desktop only.

Any Blob Scout elsewhere (Home, empty chat, onboarding) squishes when tapped.

### 3.4 Theme

Two entry points: the round theme button in the chat header (popover list) and Settings → Appearance (preview cards).

Themes: Match system, Graphite (default), Apricot, Void, Fjord, Moss, Lagoon, Plum, Sage, Aurora, Iris, High contrast.

Switching reveals the new theme in a circle expanding from the control that was clicked (600 ms, using view transitions; instant where unsupported or with reduced motion). The favicon recolors.

### 3.5 Toasts

Bottom of the chat sidebar (visible in all views on desktop). Dark pill, 5 s lifetime with a shrinking accent progress bar. Hovering pauses the timer. Only one toast at a time; a new one replaces the old.

| Trigger | Text | Action |
|---|---|---|
| Archive | Archived {chat} | Undo |
| Delete | Deleted {chat} | Undo |
| Restore | Restored {chat} to Active | — |
| Move | Moved to {project} / Removed from {project} | Undo |
| Remove project | Removed {project}. Its chats moved to Chats. | Undo |
| Create project | Created project {name} | New chat |
| Send in archived chat | Moved back to Active | — |
| Compact | Freed {n}K tokens in {chat} | — |
| Disconnect provider | Disconnected {provider} | — |
| Ticket status | Moved {key} to {status} | — |
| Start chat from ticket | Started a chat for {key} and moved it to In progress | — |
| Connect from Tickets | Connected {Jira} | — |

---

## 4. Mascots

### 4.1 Provider blobs

Generated with blobatar (MIT) from a fixed seed and hue per provider, so they look the same everywhere. They idle with breathing, bobbing, blinking, and glancing. Mood changes morph smoothly (about 300 ms).

| Where | Size | Moods used |
|---|---|---|
| AI turn header | 30 px | thinking, unsure, happy, sad, sleepy, idle |
| Provider cards (onboarding, Settings) | 42 px | idle, thinking, sad, happy |
| Defaults headers | 28 px | idle (animates on hover) |
| Home cards | 34 px | unsure (asking), sad (error), happy (done), thinking (running) |
| Composer model button | 18 px | idle (animates on hover) |
| Onboarding summary | 26 px | happy |

### 4.2 User blob

Generated from the user's name (lowercased, trimmed). Changes when the name changes. Shown in onboarding, the rail avatar, Settings, and ticket assignee.

### 4.3 Blob Scout moods

| Mood | Eyes | Antenna and spark | Body |
|---|---|---|---|
| Idle | Blink every ~5 s, follow pointer | Spark twinkles | Breathes |
| Working | Scan left and right | Spark spins and glows | Breathes |
| Alert | Wide | Antenna wiggles, spark pulses | Breathes |
| Happy | Arcs, cheeks appear | — | Hops twice |
| Sad | Droop | Antenna tilts, spark dims | Breathes |
| Tapped | — | — | Squish and rebound |

---

## 5. Browser tab

- Title "Spark Outpost".
- Favicon: Blob Scout in the theme's accent and warn colors. Happy eyes briefly when a run finishes. An amber dot appears when any chat needs input.

---

## 6. Motion spec

| Token | Value | Use |
|---|---|---|
| Ease out | cubic-bezier(.2,.8,.2,1) | Most transitions, entrances |
| Spring | cubic-bezier(.3,1.4,.5,1) | Indicators, pops, presses, popovers |

| Motion | Duration |
|---|---|
| Message enter (fade + 10 px rise) | 450 ms; 45 ms stagger on first load only |
| Sent bubble flight | 620 ms |
| Expand / collapse (height) | 350 ms |
| Segmented and rail indicators | 400–500 ms spring |
| Popover open | 240–280 ms spring |
| View switch | 450 ms |
| Theme reveal | 600 ms |
| Onboarding step | 450 ms |
| Onboarding exit | 700 ms |
| Toast in / out | 450 ms / 250 ms |
| Row remove | 260 ms |
| List reflow (FLIP) | 380 ms |
| Word stream | 34 ms per word, 350 ms fade each |

With reduced motion on, all animation and transitions are off, the theme switches instantly, and mascots stay still.

---

## 7. Keyboard and accessibility

| Key | Action |
|---|---|
| Enter | Send (composer), continue (name step), verify (API key field), create (new project field), open (focused chat row) |
| Shift + Enter | New line in the composer |
| Escape | Close popovers, menus, theme list, Settings; cancel project create or rename |
| ⌘K / Ctrl+K | Open the sidebar and focus search |

- Every control shows a 2 px accent focus ring (text fields show the composer or field ring instead).
- Segmented controls and pickers use radio roles with checked state; tabs use tab roles.
- Status icons carry text labels ("Running", "Needs your input", …).
- The context ring's label reads "Context window: 34% used, 68K of 200K tokens."
- Mascots are decorative and hidden from screen readers; their meaning is always also in text.
- Toasts and verification logs announce politely.
- Text meets contrast in every theme; High contrast swaps mascot eyes to white. See `docs/design/ACCESSIBILITY.md` for the full rule set and how it's checked.

---

## 8. Copy rules

- Sentence case everywhere. No all-caps labels.
- Buttons say what happens: "Detect and verify", "Start a chat from this ticket", "Open linked chat", "Compact".
- One name per action across the flow: the button "Archive" produces the toast "Archived".
- Errors name the cause and the fix; no apologies.
- Empty states invite the next action.
