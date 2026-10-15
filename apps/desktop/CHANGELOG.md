# Spark Outpost changelog

Newest first. Each release adds a section before packaging; the release script turns this file into `release-notes.html` on the update feed.

## 0.1.0-beta.17

- Chats: the chat list shows only each chat's title. A dot at the end shows what it's doing: a ring while it works, then amber when it waits for you, green when it's done and red when it couldn't finish. Opening the chat clears the dot, and your phone and Mac agree on what you've seen.
- Terminal: terminals use SF Mono when it's installed on your Mac, and Menlo otherwise. The rest of the app keeps Geist Mono.

## 0.1.0-beta.16

- Remote control: a paired phone or computer can follow a running Terminal session, send it a message, stop the agent and approve its permission requests. Two switches on the Remote control page turn this on, and both start off. Messages that would run a CLI command, and messages while the agent waits for an answer, stay on the Mac.
- Terminal: a starting session names the step it is on and opens as soon as its worktree exists; dependencies finish copying behind it.
- Terminal: Claude Code follows Spark's light or dark theme, also after you switch, and the last line of a terminal is no longer cut off.
- Fonts: Geist and Geist Mono ship inside the app, so nothing is fetched from Google at start, and the terminal's bold is real.
- Remote control: a paired device can get a notification when a chat needs you. Turn on Notify when a chat needs you on the Mac, then Notify this device. It names the chat, never a command, and Sender contact sets what push services see.
- Remote control: in a Terminal session, Deny takes a reason the agent reads, Send now stops the turn first, and steps fold into one row. A message to Claude waits until Claude is idle, and Claude shows the connected device.
- Pause: Pause in the left bar holds the work Spark starts by itself, while running turns and messages you send go on. A paired device can pause and resume too.
- Search: Sessions and the chat list match words from their start, show the matching line and open the chat at that message.
- Terminal: with Spark's mod loaded, a Claude Terminal session's cost by turn comes from Claude Code as each request finishes and includes sub-agents, and the Work panel shows how long each turn took. Without the mod, cost is estimated from the session file as before.
- Terminal: Record Terminal sessions like chats, under Settings → Spark, keeps a Claude Terminal session's commands, replies, changed files and audit, and flags risky pushes. It is off by default.
- Browser: in a Terminal session, Browser pane picks go into the terminal's input. Right-click highlighted page text, or press ⌘⇧A, to add it to a chat or terminal.
- Browser: an agent's click skips an element that a banner or invisible layer covers, and the agent is told what covers it. Agents read long pages controls first, read only an open dialog, and keep their place when a page redraws.
- Safety: changing a repo's .agents/ or .codex/ folder asks like other agent instruction files.
- Fixes: an interrupted dependency install is cleaned up before it runs again, and a failed dependency clone removes only its own folder.

## 0.1.0-beta.15

- Terminal: a Terminal session keeps running when Spark restarts, updates or crashes. Spark picks it up again, says so in one line, and Spark's own tools keep working in it. Quit still stops it. Claude Code steps taken while Spark was away are read back; Codex steps from that gap are not.
- Terminal: click a link in a Terminal session to open it in the Browser pane. ⌘-click opens your default browser, and right-click offers Open in Spark browser, Open in default browser and Copy link.
- Sessions (⌘⇧K, or the button beside Chats): one list of chats and Terminal sessions, the ones that need you first, with what each is doing. Type to filter, Enter to open.
- Spark Island and the companion: a Terminal session shows its current step, step count, sub-agents and model, and a turn that ends says Done.
- Under the hood: Terminal sessions run inside a bundled tmux on Spark's own socket. If it cannot start, sessions run as before.

## 0.1.0-beta.14

- Terminal: a Terminal session starts from the chat composer, with the project, agent and permissions as chips. A running session has one slim bar and the terminal fills the pane. Focus (⌘⇧F) hides the chat list and Work panel. Hide view is gone, and Stop session moved into the ⋯ menu.
- Terminal: selecting text copies it and shows a toolbar: Add to terminal (⌘⇧A), Ask about this, Comment and New chat with this. Nothing is sent for you. Hold Option to select when the agent's interface uses the mouse.
- Terminal: Shift+Tab and Tab always reach the agent. ⌥Tab and ⌥⇧Tab move out of the terminal. Line spacing no longer changes after a window resize.
- Terminal: the Work panel shows the session's steps, and tokens and an estimated cost for each turn. Claude Code's own session total appears when it exits. Spark stores tool names and times, never commands, paths, prompts or output.
- Browser: agents can open any web address in the Browser pane and click, type and scroll there, so you can watch. It follows the agent's mode, with one card per site otherwise. An agent's tab on a website starts signed out, even where you are signed in. Typing a value from a secret file asks first in every mode, and agents cannot type into password fields.
- Spark Island: a line beside Scout says what is waiting, done or failed. Later leaves a mark and stays set aside after a restart. The Home tab shows what a quiet session last said, and names Terminal sessions.
- Spark Island: no chime for a request in the chat you are viewing, and a new chime when a chat could not finish.
- Mac: the Dock icon shows how many chats need you. With Spark Island off, a notification names the chat, and clicking it opens that chat. Turn it off under Settings → Spark.
- Outposts: an approval from a member chat names its handle in the Island line.

## 0.1.0-beta.13

- Sub-agents: when an agent uses its own sub-agents, the chat and Agent TV list them with their state. Open one to see its steps, the files it changed, the commands it ran, its report, tokens and duration. Codex sub-agents also show their model and an estimated cost.
- Sub-agents: the chat, the sidebar and Spark Island say "Waiting on 2 sub-agents" while the agent only waits. Enter then sends your message to the agent at once, and nothing is cancelled.
- Sub-agents: Claude and Z.ai sub-agents always run in the background, so they never block the agent. Codex no longer gives up on a sub-agent after 10 minutes.
- Sub-agents: Stop ends sub-agents and the commands they started. A permission card from a sub-agent names it, and the audit log has an Agent filter.
- Cost: a turn's tokens include its sub-agents, and the Cost tab lists usage by sub-agent.
- Fixes: a Title line no longer shows in the middle or at the end of a reply.

## 0.1.0-beta.12

- One chat is one agent session. Your message goes to the agent as typed, and the agent decides whether to plan, use its own sub-agents or propose sub-chats. Crews, pieces, the Critic and Spark's own checks are gone, along with their settings. Older chats keep their crew, replies, costs and plans, read-only.
- Publishing is one request to the agent after its reply. A pull request is a draft only if you ask or Settings says so, and "push, no PR" only pushes.
- Outposts: a chat can propose sub-chats as a draft you start, in parallel or stacked on one another, each with its own branch and pull request. A story bar follows them to a wrap-up. Chats can ask each other, and you can address several chats in one message with @ anywhere in it. Member chats sit under their outpost in the sidebar.
- Agent terminal: an agent can keep a command running after its turn, with Stop. Open in terminal on a reply's command mirrors it in a read-only tab.
- Phone is now Remote control. Paired devices stay paired.
- Safety: an agent can push only the chat's own branch and cannot change remotes. Claude asks before changing instruction files, git hooks and git config in every mode, worktrees included. Chats started by Spark get no account connectors.
- Plans: Spark saves a plan only when you approve the agent's. Codex /plan is read-only and shows a proposed plan.
- Models: Auto means the provider's default model, and the chat names the model that ran. Jev works only on the Map, PR feedback and Spark Island.
- Fixes: Allowed cards no longer appear after /plan in Bypass permissions, tables no longer break words mid-label, and the message box grows with wrapped text.

## 0.1.0-beta.11

- Outposts: put several chats in one outpost and ask each for work from one thread with @ and its handle. Each request shows its state (Sent, Working, Needs you, Answered, Failed, Cancelled), and the answer lands under it with its branch, files and pull request. Notes start no work. Pause holds requests that have not started.
- Outposts: New outpost is a three-step sheet. Add existing chats or new ones with a project, agent and permissions, give each a first message with files, review, then start. Each chat is introduced in the thread and has its own face.
- Outposts: a request you type counts as your message, so "open a PR" publishes and a slash command runs. Answer a chat that needs you from the outpost. Agents cannot ask each other yet.
- Phone: a paired phone can save a passkey and use it to sign in again in another browser at the same address, as the same device. The switch and removal stay on the Mac.
- Pull requests: a pull request that was closed and reopened shows as open again. The row has a refresh button, and shows the repository name with lines added and removed in place of the full title.
- Chat header: Agent TV, Browser and Terminal moved into the chat menu (⋯).
- Tickets: moving a Jira ticket to Done no longer lands on another status in the same category, such as Rejected. Pick the status for each move in the connection's settings.
- Terminal sessions: Esc is noticed reliably when the Mac is busy.

## 0.1.0-beta.10

- Spark Island: at rest Scout is tucked at the top so about half shows, under the notch or the top edge of the screen. Scout comes fully out while a chat is working, needs you, has just finished or failed, and tucks back afterwards. An Island you dragged away from the top stays whole.
- Spark Island: a new size, Extra large, twice the size of Large.
- Spark Island: on a display with a notch, and when floating, Scout now follows the Spark Island size. It was a fixed small size before.
- Spark Island: pointing near Scout opens the Island. The area that reacts reaches about a third of Scout's width to each side and below.
- Known: on a display with a notch, pointing at the very top edge above Scout may not open the Island. Point at Scout.

## 0.1.0-beta.9

- Chat: replies, your messages and the message box share one centred column, wider than before, and a reply's text sits under the agent's name. Table headers no longer break in the middle of a word.
- Chat: Make the change is removed. Ask for the change in your next message.
- Work panel: the rail lists the same crew as Agent TV and keeps it after the turn ends, and the task list no longer scrolls inside a short box.
- Sidebar: a chat whose pull request was merged shows a merged icon.
- Terminal sessions: pressing Esc while the agent is replying shows the session as waiting for input instead of Running.
- Terminal sessions: the note Spark gives the agent is sent as a system instruction and no longer appears as a dark bar above your first message.
- Spark Island: press the resting blob and drag to place it anywhere, including up beside the notch. The place is saved when you let go. On a display with a notch it docks again only when dropped on the notch, and a floating Island rests as the blob alone.
- Spark Island: the log records where the Island was placed on each display, to help diagnose a blob that sits too low.
- Known: Esc before a Terminal agent has started replying still shows Running until its next event.

## 0.1.0-beta.8

- Terminal sessions: New chat → Terminal runs the real Claude Code or Codex CLI in a terminal Spark owns, in the chat's worktree, with your agent mode and Spark's tools. The chat row shows Running, Waiting for input, Waiting for permission or Idle from the agent's own events. Hide view keeps the agent running, Open terminal reattaches, and Stop session asks you to hold. Spark's cards, protected paths and audit do not apply inside a Terminal session, and it opens no pull request by itself.
- Terminal sessions: a session whose agent exited, crashed or was interrupted offers Resume session where the agent supports it, and otherwise Start again, which resends your first message. A session you stopped stays stopped.
- App: agents and the local services now run in a runtime of their own. Closing the window or a crash of the window leaves agents running, and opening Spark again reattaches. Quit stops them. An update replaces the older runtime when the new version starts.
- Settings → Spark: Use Spark workflow turns Spark's own workflow off for direct agents, with the remaining choices under Workflow options. Custom instructions take text and a file, and are sent to every agent, Terminal sessions included. With Spark off, the agent gets your custom instructions and nothing from Spark.
- Chat: links in a reply or a card open in the Browser pane first; ⌘-click or Open in default browser uses yours.
- Chat: the Work panel keeps the Crew list after a turn ends, with each agent's model, tokens, cost and time. The rail reads "Crew · N agents".
- Chat: the message box has no length limit.
- Chat: Save as agreed plan is removed. A build saves its plan by itself, as before.
- Chat: a finished build is no longer stopped as "the Builder is missing context" because its reply quoted a "No such file" line from a command.
- Chat: the hidden Title line stays hidden when your custom instructions add a short sign-off after it.
- Commands: `gh` commands that only read (pull request, run, issue and API reads, with or without output redirects such as `2>&1`) are no longer refused by the publish rules. `gh auth status --show-token` and `gh auth token` are not reads.
- Secret files: reading a secret file outside the linked repos follows the agent's mode and is recorded in the audit by path, and the card names the file. Changing, moving or deleting a secret file, and reading a file listed in `.sparkignore`, still ask.
- Spark Island: at rest it shows only the blobs, opens on hover or click, and keeps its place on the display you chose.
- Sidebar: long chat titles and status text no longer overlap.
- Known: Terminal sessions are Mac-only and are not available from a paired phone.
- Known: Claude Code and Codex ask once per repository whether to trust the folder the first time you open it in a Terminal session.

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
- Known: a plan saved from a reply with Save as agreed plan shows in the chat, but the Work panel has no Plan tab for it until the chat has a task.

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
