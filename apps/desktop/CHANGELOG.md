# Spark Outpost changelog

Newest first. Each release adds a section before packaging; the release script turns this file into `release-notes.html` on the update feed.

## 0.1.0-beta.7

- Fewer cards: Spark raises no plan, question, retry or verify cards of its own. An unclear request, a step that failed twice or a change Jev could not confirm ends the reply with "Needs you: …"; answer in your next message. The chat's sidebar row shows that line.
- Plans: when a message is a build, Spark saves the plan it already has as the chat's agreed plan, shows one line such as "Plan saved · 4 pieces" and keeps building. `/plan` and a chat in Plan mode use the agent's own plan approval, and a question in a Plan-mode chat is answered as usual.
- Plans: what an approved plan builds is checked, shown in Changes and kept or shipped by the chat's Spark autonomy level. A build in a Plan-mode chat keeps the chat's level instead of ending as Automatic.
- Pieces: pieces share one working tree in every agent mode, with files assigned by the Coordinator. A piece's change to a file another piece owns is never refused or reverted: it is flagged with a card that does not stop the run and passed to the owning piece.
- Messages during a build: Jev sorts each one. A question is answered at once, a requirement goes to the piece working on those files or to the follow-up, and unrelated work is queued.
- Crew: Builders and pieces stay on the chat's provider and agent mode. A piece whose provider is rate-limited or signed out fails with the plain reason instead of moving to another provider. A chat pinned to a model runs every Builder and piece on it and says which model Jev would have used.
- Pieces: a piece running when you press Stop reads "stopped", not failed.
- Models: new chats start on Auto. Claude Sonnet 5.5 and Claude Haiku 5.5 have model cards, and Settings → Models is one comparison table per provider with tier, prices, context, speed and effort.
- Models: with Auto, the message box and the context panel name the model that did the chat's work. A resumed Claude session runs the model you picked, and the name keeps its room while pieces run.
- Chat: one quiet result line under a turn replaces the kept card: files and lines, checks, the commit, the pull request, thumbs and Revert. Ship stays in the Work panel's Changes tab. An approval that timed out reads "waited for you", with Try again.
- Chat: the status line says what Jev is doing between agents (reading the message, picking models, checking a piece or the change) instead of "planning".
- Chat: the Thinking step opens to show the agent's thinking, and Claude now sends thinking summaries.
- Chat: commands an agent runs show their output in a small read-only terminal in the reply. Codex output is live; Claude's appears when the command ends.
- Chat: the ticks sit at the chat's left edge, and the chat can no longer scroll under the message box.
- Pull requests: the pull request is a one-line row above the message box that opens to every check, each reviewer's verdict and the open comment threads; Links shows the same. An eye on the row says who is on it: Watching, Agent is on it, Paused or Follow-up off.
- Checks: a failing check is blamed on the change only with evidence. Failures Spark cannot place are one calm row, with no fix turn and no draft, and setup problems such as the wrong Node version are named as such.
- Secret files: reading a secret file inside a linked repo follows the agent's mode and is recorded in the audit by path. Changing, moving or deleting one still asks, and so does reading a file listed in `.sparkignore` or a secret file outside the linked repos.
- Sending data: after a turn read a secret file or other private data, a send no longer adds a card of its own. It runs or asks as the agent's mode decides, with a note and an audit entry, and work on the chat's own repository and pull request is not a send. A push or upload that holds a secret file's value asks with hold-to-confirm in every mode.
- Tickets: a ticket shows Development, with its linked pull requests and branches. A chat started from a ticket gets the key, title, status and link, and the agent reads the rest itself.
- Spark Island: Full is the default size, nothing sits under the camera notch, and a chat that needs you opens its card once without taking the keyboard.
- Phone: the pairing blob moves while phone access turns on, a code waits and the time runs down. Pairing again keeps one device, a paired phone stays signed in when it arrives from another app, Tailscale answers when Spark was opened from the Dock, and a refused turn-on keeps showing its reason.
- Providers: a signed-out provider says so instead of "stopped unexpectedly", and the turn is not retried.
- Cost: a run on a session you stopped earlier is no longer charged that session's earlier cost again.
- Changes: the files-changed total is the net change with each file counted once, and a piece's diff starts from the tree as it was when the piece started.
- Routing: a request is destructive only when it deletes data, files or history; adding a `truncate` helper or a `delete` method is not.
- Jev: keys are redacted in more of what is sent to Jev: your message and attached text, plan entries, next-step choices and Map area names and paths.
- Sessions: the limit that closed sessions of other chats with "too many open sessions" is removed.
- Ship: a commit Spark makes is named after its own turn, not the chat's first request.
- Known: on Codex in Ask every time, an approved change to a secret file still fails; change the file yourself.
- Known: in a Plan-mode Claude chat, a build request sent after a question may build without showing a plan first.

## 0.1.0-beta.6

- Phone: a Phone page above Settings. Turn on phone access over Tailscale Serve, pair a phone with a QR code and a matching code, manage devices, choose what a phone may do and see recent phone activity. A paired phone does what the Mac app does, except the Browser pane, preview and terminal.
- Phone and tablet layout: a phone on its side keeps the phone layout, the phone bar is Home, Chats, Analytics, Tickets, Docs and More, with no Map or floating blob, menus stay on screen, tap targets are larger and Spark can be added to the home screen.
- Chat: "On this chat" moved to ticks left of the thread. Text keeps a narrower reading width, the chat has its own top bar, and the context rail sits at the right edge with a bigger crew stage. Below 1280px wide, the Work panel slides over the chat while the chat list is open.
- Chat: a message sent to a running turn shows in the thread. Agent screenshots appear where they were taken, as small thumbnails that open full size. The Coordinator's piece list no longer shows as raw text.
- New chats start at Full auto → PR. Run budgets are removed: time, tool calls, tokens and cost are shown, never capped.
- Fewer command cards: reading Spark's own data about the chat, or running a local script that opens no connection, no longer asks.
- ⌘D opens the Changes drawer.
- Updates: Restart to update checks for a newer version first and installs only the newest. Updates download only what changed, starting with the update after this one.
- Pull requests: agents push the chat's branch and open the pull request themselves in one publish turn. Spark tracks every pull request of a chat with its checks and reviews, and follow-up fixes go to the same branch.
- Models: Spark knows which models each provider sign-in can use, hides the rest, and when a provider rejects a model it retries once on the nearest usable one and says so in the chat.
- Chat: an interrupted turn offers Continue from here or Start fresh. Answering a question card no longer blanks the turn, and sending while a turn runs brings the thread back to the latest.
- Projects: clone a repository into a new project from the sidebar or the empty Map. Project rows in Settings start closed.
- Slack: Sign in with Slack is the first way to connect; your own Slack app is the advanced one.
- Browser: saved sign-ins per project. Spark types them into the saved site after a card; the username and password stay in the keychain.
- Checks judge the change, not the repository: a check that already failed before the change is one calm row. Choose a project's check commands in Settings, or turn checks off.
- Changes view: word marks only for real line edits, calmer tints and old line numbers.
- Tickets: failing checks are a notice under In review, not Needs you.
- Approvals: pieces sharing a folder follow the agent's mode, and the system temp folders are scratch space.
- Spark tools: a session is offered only the tools its chat can use. A confirmed Spark action shows what it is doing and how it ended.
- Look: the Chats list sits on its own raised panel.
- Updates: a stalled install returns to Restart to update with a reason.
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
