# Spark Outpost changelog

Newest first. Each release adds a section before packaging; the release script turns this file into `release-notes.html` on the update feed.

## 0.1.0-beta.6

- Phone: a Phone page above Settings. Turn on phone access over Tailscale Serve, pair a phone with a QR code and a matching code, manage devices, choose what a phone may do and see recent phone activity. A paired phone does what the Mac app does, except the Browser pane, preview and terminal.
- Phone and tablet layout: a phone on its side keeps the phone layout, the phone bar is Home, Chats, Analytics, Tickets, Docs and More, with no Map or floating blob, menus stay on screen, tap targets are larger and Spark can be added to the home screen.
- Chat: "On this chat" moved to ticks left of the thread. Text keeps a narrower reading width, the chat has its own top bar, and the context rail sits at the right edge with a bigger crew stage. Below 1280px wide, the Work panel slides over the chat while the chat list is open.
- Chat: a message sent to a running turn shows in the thread. Agent screenshots appear where they were taken, as small thumbnails that open full size. The Coordinator's piece list no longer shows as raw text.
- New chats start at Full auto → PR. Run budgets are removed: time, tool calls, tokens and cost are shown, never capped.
- Fewer command cards: reading Spark's own data about the chat, or running a local script that opens no connection, no longer asks.
- ⌘D opens the Changes drawer.
- Updates: Restart to update checks for a newer version first and installs only the newest. Updates download only what changed, starting with the update after this one.
- Known: phone access has not been tried with a real Tailscale network or a real phone yet. Layouts were checked in a desktop browser at phone and tablet sizes only.

## 0.1.0-beta.5

- Updates: Restart to update installs with Spark Island on. Earlier betas stayed on "Installing…"; on those, turn the island off in Settings, update, then turn it back on.
- Plans: Spark offers to save a reply as the agreed plan only when Jev reads that reply as a plan of work, so a plain "ok" in a casual chat no longer brings up the offer.

## 0.1.0-beta.4

- Chat: question, plan and approval cards sit just above the message box. Question cards are calmer, take several quick answers per question, wait 60 seconds by default and have a setting for the wait.
- Chat: one working status per turn and per crew member. Tasks show as a list in the context rail, and each turn says what Jev did.
- The context rail shows whenever the right sidebar is closed and the window has room. On very wide screens it stays beside the thread.
- Browser: tabs sit in the top row with + after the last tab, a picked element is one "Selected:" chip, and a new chat starts with the pane closed. A per-project Preview setting starts your dev server for agents.
- Spark Island: shows the file being read or edited and each edit's change, shows changed lines on edit approvals, is Large by default and hides while Spark is focused.
- Share a chat with another chat: Copy chat link, then paste it or pick it from the plus menu. Agents read the other chat read-only.
- Tickets: one-line views in the sidebar, compact status badges, and Start at the end of the row on hover with nothing hidden.
- Settings: Teammates replaces the second Spark section, Projects and Models are shorter lists, cards have no outer border, and the version moved to Updates.
- Look: the area around the main panel matches the sidebar, and the Dock icon sits on a graphite tile.
- Known: with the context rail showing, sending a message in a very long chat can take a little over 100 ms to draw. Hiding on focus and the notch edge of Spark Island were not checked on a real screen before this build.

## 0.1.0-beta.3

- Browser: a Browser tab in the work panel that you and agents share. Agents open local pages, read them, take screenshots and read console and network logs. Pick an element or drag a region to point at something. Sign-ins are kept per project.
- Slack: connect your own Slack app for notifications, shared threads as context, confirmed posts and starting work from Slack. Direct messages are readable only when you allow them.
- GitHub sign-in through the Spark Outpost GitHub App, with no pasted token. The token and gh options remain.
- While a turn runs, Enter queues a message and ⌘Enter sends it now. A setting flips the default.
- Tested with Claude and Codex. Z.ai has not been tested with the browser yet.
- Known: Codex cannot start a dev server in its default mode, and a dev server Claude starts ends with the turn. Start the server yourself for now.

## 0.1.0-beta.2

- Plan card: "Build this plan?" waits for you in Automatic; Full auto → PR still continues on its own.
- Two autonomy levels (Automatic, Full auto → PR). Spark follows the agent's mode and adds no command cards of its own.
- Chat: plain step names, one status line, steps collapsed by default, one wider column on wide windows, a context rail with an outline and a docked Agent TV.
- Sparks: the blob comes from the name, instructions can come from a file, `@Name` hands a job to a Spark as a read-only subagent, and Settings → Sparks can delete one.
- Tickets: the inbox sidebar is back, with status badges, reporter, created date, pull requests and a resizable detail pane.
- Spark Island: wider, attached to the top edge, shows each chat's state, takes dropped files and folders, and uses Spark's own folder picker.
- Agents can find code with `spark_find`, search tickets and manage MCP servers through Spark tools.
- Docs rewritten into short task pages with a "What do you want to do?" start page.
- Faster: smaller startup bundle, cheaper blob animation, quicker turn start, fewer database queries and writes.
- Fixed: deleting chats, projects and Sparks in the Mac app; attachment links open inside Spark; the Map's stray card borders.
- New Dock icon without the white tile.

## 0.1.0-beta.1

First beta for a few testers.

- First packaged desktop build: bundled Postgres, agent adapters and server.
- Updates in the background on Stable or Beta, installed on quit or with Restart to update, never while agents are working.
- A backup before every update that changes the database, restored automatically if the update fails.
- Settings › Help: export diagnostics, show the logs folder and send feedback. Also in the Help menu.
- App logs in `~/Library/Application Support/Spark Outpost/logs`, with keys and tokens redacted.
- Beta builds start on the Beta update channel.
