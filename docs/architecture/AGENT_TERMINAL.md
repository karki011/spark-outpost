# Agent terminals

Status: design, October 9, 2026. No feature code yet. Nothing here ships until the owner approves the section at the end.

Goal: when an agent runs a command, the user can see that a terminal is going on. There is the small terminal in the reply (today) and a tab in the Terminal dock to watch it, check on it and stop it. A long-running command (a dev server, a watcher) keeps running in its tab after the turn ends.

Pinned versions this was checked against: `@agentclientprotocol/sdk` 1.5.0, `@agentclientprotocol/claude-agent-acp` 0.81.2 (Claude and Z.ai), `@agentclientprotocol/codex-acp` 1.13.1, both adapters with our patches (`patches/`).

## Short answer

1. Option A (ACP client terminals) does not work today. Neither pinned adapter ever calls `terminal/create`. Advertising `terminal: true` would change nothing.
2. Build Option C first: an "Open in terminal" tab that mirrors a command the agent runs itself. It is web-only, adds no authority and needs no migration.
3. Then build Option B for commands that must outlive the turn: one Spark tool, `spark_terminal_run`, that runs a command in a Spark-owned PTY in a dock tab. Spark applies the rules itself, through the same approval gate the agent's own commands use.
4. The agent's own command tool stays the default for everything else. Its own permission prompt stays in charge there.

## What the code says today

| Fact                                                                                                         | Where                                                                                                            |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Spark advertises `terminal: false` and registers no `terminal/*` handlers                                    | `apps/server/src/agents/acp/client-info.ts:12`, `acp-provider.ts:329-355`                                        |
| A command is a `tool_call` with `kind: execute`; output is read from the tool call                           | `apps/server/src/agents/acp/command-output.ts`                                                                   |
| Codex streams output deltas; Claude and Z.ai report output once, when the command ends                       | `agents.ts:322` (`streamsCommandOutput` only on Codex), `ACP_AGENTS.md` "Command output"                         |
| Commands are stored per run, redacted, with a 64 KB tail                                                     | `apps/server/src/workflow/command-recorder.ts`, `persistence/run-commands.ts`, migration `0140_run_commands.sql` |
| The reply shows them in a small read-only terminal                                                           | `apps/web/src/chat/commands/CommandTerminal.tsx`, `CommandScreen.tsx`, `command-model.ts`                        |
| One agent process per turn. It is killed with its whole process tree when the turn ends or is stopped        | `acp-provider.ts:143` and `:249` (`agent.kill()`), `agent-process.ts` (`killProcessTree`)                        |
| The dock has three session kinds: `setup`, `shell` (user shells and native agent CLIs) and `view`            | `apps/server/src/terminal/sessions.ts:46-91`                                                                     |
| A `view` session shows a process another module owns. The preview server uses it                             | `sessions.ts:215` (`createView`), `api/preview-routes.ts:94`, `preview/servers.ts:141` (`view`)                  |
| Spark already runs one long-lived process per project outside the agent: the preview server                  | `apps/server/src/preview/servers.ts`, `preview/process.ts` (node-pty, login shell), tool `spark_browser_preview` |
| Terminals live in the API process. Spark tools run in the worker. They meet through database rows and NOTIFY | `SPARK_TOOLS.md` "Terminal sessions", `preview/requests.ts`                                                      |
| The gate judges a command from an `ApprovalRequest` (`kind: 'execute'`, command, cwd, roots, mode)           | `apps/server/src/approvals/decide.ts:39-56` and `:271`, `workflow/approval-gate.ts`, `providers/provider.ts:121` |
| The audit marks a tool call that finished with no permission request as ran without review                   | `apps/server/src/audit/review-tracker.ts`, `workflow/audit-recorder.ts:111-123`                                  |
| Every terminal route is Mac-only for a paired phone                                                          | `apps/server/src/remote/route-rules.ts:170-183`                                                                  |
| On quit, managed PTYs and previews stop                                                                      | `apps/server/src/api/main.ts:249-256`                                                                            |

## The three options

### A. ACP client terminals (`terminal: true`)

The idea: the agent's own command tool asks Spark to create the terminal. Spark owns the PTY. The agent's own permission prompt still decides. This would be the best outcome.

It does not work with the pinned adapters.

- **Claude and Z.ai (claude-agent-acp 0.81.2).** `dist/` has no call to `terminal/create`, `terminal/output`, `terminal/kill`, `terminal/wait_for_exit` or `terminal/release`. It never reads `clientCapabilities.terminal`. The Bash tool runs inside the Claude Agent SDK process. The adapter only reads two display hints, `clientCapabilities._meta.terminal_output` and `terminal_output_delta` (`dist/acp-agent.js:5527`, `:7627`). With a hint on, it puts the whole output in `_meta` on the tool result (`dist/tools.js:713-737`). That still arrives when the command ends, so it is not live. The `tool_progress` heartbeat carries elapsed seconds only, no output (`dist/acp-agent.js:4588-4640`).
- **Codex (codex-acp 1.13.1).** `createTerminal` and the other terminal methods appear only in the bundled SDK method table (`dist/index.js:26295-26299`, `:26785-26789`, `:27115-27119`). Nothing calls them. Codex runs commands in its own app-server and sandbox and forwards `item/commandExecution/outputDelta` as `_meta.terminal_output_delta` (`dist/index.js:28076-28104`, `:30124`).
- Our patches (`patches/*.patch`) do not touch any of this.

So with `terminal: true` no adapter would call us, and nothing would change for the user. `ACP_COVERAGE.md` already lists `client-capability:terminal` as missing for this reason. Recheck with the same search when an adapter is bumped. If an adapter starts using client terminals, A becomes the better home for ordinary commands and this document should be revisited.

Two things the adapters do offer, which we are not choosing now:

- Claude reports background Bash tasks through the JetBrains AIR `asyncTasks` capability: `async_task_spawned` with an output file path, and a `_session/async_task/stop` request (`dist/async-tasks.js:350-368`, `dist/acp-agent.js:165`, `:1966-1979`). This is Claude-only, and the task dies with the agent process at turn end. It could later give live output and a per-command Stop for Claude background commands inside a turn.
- Codex has `thread/backgroundTerminals/list` and `terminate` on its app-server (`dist/index.js:34981-34986`). The adapter does not expose them over ACP.

### B. A Spark tool that runs the command in a Spark-owned tab

Works for every provider, because Spark tools reach all of them. The process belongs to Spark, so it can outlive the turn. Output is live for Claude too.

The cost: the agent's own permission prompt does not see what the command does. Codex pre-approves Spark tools (`spark-tools.ts:74`). A command run this way also runs outside the Codex sandbox. So Spark must apply every rule itself. That is new authority and needs a new AGENTS.md sentence.

### C. Mirror only

A read-only dock tab fed from the output Spark already receives and stores. No new authority. No server change. Limits: Claude and Z.ai output still appears only when the command ends, the command still dies with the turn, and Spark cannot stop one command, only the turn.

### Choice

- **C now.** It gives "a terminal is going on, open it in the dock" for every command with almost no risk.
- **B next, kept small.** It is the only way to meet "keeps running after the turn ends", because the agent process tree is killed at turn end. One tool, four actions, no input channel.
- **A not built.** Nothing would use it.

The preview server stays as it is. It is the user's saved command for the project. `spark_terminal_run` is for other long-running commands the agent picks.

## What the user sees

### In the chat

- Every command keeps its small terminal in the reply, as today.
- New on that small terminal: an **Open in terminal** button. It opens the Terminal dock on a tab for that command.
- A command Spark runs for the agent shows as the same small terminal with a chip **Agent terminal**, a running mark, the elapsed time, **Open in terminal** and **Stop**.
- When it is no longer running the row says how it ended: `exit 0`, `stopped by you`, `stopped by the agent`, `stopped when Spark quit`.

### In the Terminal dock

- Tabs for agent commands sit next to the user's own shells. Each is labelled as the agent's: `Claude · pnpm dev`, `Codex · vitest --watch`. An icon and the words "run by the agent" in the tab title tell it apart from the user's shells without relying on color.
- A running tab shows the same running light the other tabs use. The Terminal entry in the chat header already shows "Running" when the dock is hidden and a tab is alive.
- The tab is read-only. The user can scroll, select and copy. There is no typing into it in the first version.
- **Stop** on an agent terminal ends the process. It uses the same hold-to-stop confirmation the dock uses when a shell is busy.
- A mirror tab (Option C) has no Stop of its own. It says "This command belongs to the agent's turn" and offers **Stop turn**, which is today's Stop.
- For Claude and Z.ai a mirror tab says "Output shows when the command ends", the same words the small terminal uses.

### What happens when

| Event                                  | Mirror tab (agent's own command)                         | Agent terminal (Spark-run)                                                                                |
| -------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| The turn ends                          | The command has ended or is marked interrupted, as today | Keeps running. The tab stays. The reply's last line says "1 agent terminal still running"                 |
| The user stops the turn                | Interrupted with the turn, as today                      | Terminals started in that turn stop. Terminals from earlier turns keep running (owner decision 4)         |
| The user closes the tab                | Tab closes. Nothing else changes                         | Asks: stop it, or keep it running. Keeping it leaves the row in the chat, where it can be opened again    |
| Window closed, refresh, renderer dies  | Rebuilt from the saved command                           | Keeps running in the local runtime. Reopening shows the kept output and goes on live                      |
| Quit Spark                             | Nothing to do                                            | Stops, like every managed PTY. Marked "stopped when Spark quit"                                           |
| Start Spark again, or the Mac restarts | Saved output is still in the chat                        | Not started again. Starting a command needs a fresh decision. The row offers nothing but its saved output |
| The chat is deleted                    | Gone with the chat                                       | Stopped, then removed                                                                                     |
| The worktree folder is removed         | Nothing                                                  | Stopped, like a shell whose folder is gone                                                                |
| A later turn of the same chat          | Nothing                                                  | The agent can check it, read its recent output and stop it with the same tool                             |

### On a paired phone

Terminal stays on the Mac. The phone shows the row in the chat with the command and its state as text. It has no "Open in terminal", no output and no Stop. Every new route goes in the Mac-only part of `route-rules.ts`, or the policy test fails. A turn started from the phone can still call the tool. Its card, if one is raised, is an ordinary approval card and follows the existing phone switches.

## The mechanism

### Phase 1: mirror tab (Option C)

- Web only. The tab renders the same command state the reply already holds. The run event stream stays the one owner of that state.
- The dock store's `preview: boolean` becomes a tab kind: `shell`, `preview`, `command` (mirror), `agent` (phase 2). A third boolean would be the third copy of one pattern.
- The tab mounts the shared output view (`apps/web/src/terminal/output-view.ts`) that `CommandScreen` already uses. No PTY, no socket, no route.
- A finished command opens from its saved tail through the existing `/runs/:id/commands/:id/output` request.

### Phase 2: `spark_terminal_run` (Option B)

One tool with an `action`, like `spark_browser_preview`, so the tool list grows by one entry:

| Action   | Does                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| `start`  | Runs one command in a new agent terminal. Returns its id and state. Returns at once |
| `status` | Lists this chat's agent terminals: id, name, command, state, exit code, started     |
| `output` | The last lines of one terminal (up to 200), redacted and marked untrusted           |
| `stop`   | Stops one of this chat's agent terminals                                            |

Rules of the tool:

- It exists only in a chat with a project folder, in a turn that may run commands. An Ask turn, a read-only mode and a chat with no folder get a refusal in one line.
- The command runs in the chat's working folder (the worktree by default), or a folder under a linked root.
- It runs in the user's login shell, as the preview server does, with Spark's own variables removed from the environment.
- There is no action that sends input. An agent must not be able to start a shell and then feed it lines the gate never saw. Each `start` is one command and one decision.
- The command text is refused when it looks like it holds a secret, the same check MCP server commands get (`spark-mcp/actions/mcp-config.ts`). The exact text is stored locally so the runner can start it.
- The description tells the agent to use it only for commands that must keep running after the turn, and to use its own command tool for everything else.

How it runs, following the preview server:

1. The tool (worker) gets a decision from the gate. See "Permissions".
2. It inserts a row in `agent_terminals` with `wanted = 'running'` and appends an `agent_terminal_started` event to the run, anchored in the reply like a command.
3. The API process is notified, spawns the PTY, records the pid and keeps a replay buffer and a saved tail.
4. A dock tab opens a `view` session on it (`TerminalSessions.createView`), as the Preview tab does.
5. Stop, from the user or the agent, sets `wanted = 'stopped'`. The API kills the process tree and records who asked.

The reply row reads its state with TanStack Query and refreshes on the app event. Live output goes only through the dock socket. The server row is the one owner of the state.

Tool output is the agent's own command output. `SPARK_TOOLS.md` says tools never return terminal output, with the preview server as the one exception. This becomes the second exception, with the same wrapping: redacted, clipped, marked as untrusted program output.

## Permissions

The agent's own commands are untouched. Their permission prompt, the gate, the audit and the rail flags work as they do today. The mirror tab changes none of it.

For a command started with `spark_terminal_run`, Spark is the one that runs it, so Spark decides, every time, in every mode.

1. **Same gate.** The tool builds the same `ApprovalRequest` an agent's own command produces (`kind: 'execute'`, the command, the folder, the linked roots, the agent's current mode) and hands it to the turn's own `PermissionGate.review`. There is no second rule set.
2. **The agent's mode asks or runs.** It runs at once in Auto, Bypass permissions, Approve for me and Full access. In every other mode an ordinary approval card appears, with the command and the line "Runs in a Spark terminal, outside the agent's sandbox, and keeps running after the turn." This is the rule Spark action tools already follow.
3. **No shortcuts.** The project allowlist and "always allow in this run" do not apply to these commands, and the card offers only Allow once and Reject (owner decision 2). Those shortcuts were given for commands the agent runs in its own sandbox.
4. **The safety floor holds in every mode.** Changing, moving or deleting a secret file and changing an agent instruction file ask. Git hooks and git config ask with hold-to-confirm. Force pushes are refused. Writes and deletes outside the linked repos ask, except in the system temp folders. A file in `.sparkignore` asks to read.
5. **Publish rules apply as for a solo Builder's own `git push` and `gh`.** A push of anything but the chat's own `spark/*` branch is refused. Publishing needs one of the existing grounds (the message asked, Full auto → PR, the mode, a follow-up round). `--no-verify` is refused. A push that holds a value from a secret file asks with hold-to-confirm. Pieces and the Coordinator still never publish.
6. **Reading then sending.** If the turn read a secret file or other work data, a command that sends off this computer gets the same note and audit entry as today.
7. **A refusal is an answer, not an error.** The tool returns the gate's reason in one line so the agent can tell the user.

This is stricter than the agent's own commands in one case, on purpose. In Claude Bypass permissions and Codex Approve for me or Full access, the gate never sees the agent's own commands, so Spark can only flag a hard-rail crossing after the fact. A Spark-run command always passes the gate first, so a hard rail stops it or asks before it runs.

### Audit

- Each `start` writes a run-audit entry `spark/terminal_start`: the redacted command, the folder, the decision (`mode`, `card` with the approval id, or `refused` with the reason) and the terminal id.
- Each stop writes `spark/terminal_stop` with who asked: `user`, `agent`, `turn_stopped`, `quit`, `chat_removed`, `folder_removed`.
- The exit is recorded on the row: exit code and time.
- **Ran without review.** A start that no card approved, because the agent's mode acts without asking, is marked ran without review. This is the mark the agent's own command gets in that mode. A start the user allowed on a card is not marked.
- The audit holds paths and redacted command text. It never holds output.

## What does not change

- `terminal: false` stays. No ACP `terminal/*` handlers are added.
- The agent's own command tool, its permission prompt and its sandbox.
- The small terminal in the reply, the command events and the `run_commands` table.
- User Terminal sessions. The safety floor still does not apply inside them. An agent terminal is not a Terminal session: it runs one gated command and takes no input.
- The preview server and `spark_browser_preview`.
- Spark autonomy levels. They still decide only what happens to the result.
- No budgets. An agent terminal has no time limit and no idle limit. The only limit is how many can be open at once, like the dock's existing limit on shells.
- Nothing merges, and Spark resolves no threads.
- Phone access. Terminal stays on the Mac.

## Data model

Phase 1 needs no migration.

Phase 2 needs one table. The next free migration number is `0162`. Do not create it before approval.

`0162_agent_terminals.sql`, table `agent_terminals`:

| Column                                    | Notes                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `id uuid` primary key                     |                                                                                |
| `workspace_id`, `conversation_id`         | Not null, cascade on delete                                                    |
| `run_id`                                  | The run that started it. Set null when the run is deleted                      |
| `provider`                                | For the tab label                                                              |
| `name`                                    | Short label, at most 60 characters                                             |
| `command`                                 | Exact text, at most 4000 characters. Refused earlier if it looks like a secret |
| `cwd`                                     | Absolute folder                                                                |
| `wanted`                                  | `running` or `stopped`                                                         |
| `status`                                  | `starting`, `running`, `exited`, `stopped`, `failed`, `interrupted`            |
| `exit_code`, `pid`                        | Nullable                                                                       |
| `decided_by`, `approval_id`               | `mode` or `card`, and the card                                                 |
| `stopped_by`                              | Who asked for the stop                                                         |
| `output`, `output_chars`                  | Redacted tail, at most 65536 characters, and the total, as in `run_commands`   |
| `text_offset`, `text_before`, `text_held` | Where the row sits in the reply, as in `run_commands`                          |
| `started_at`, `ended_at`                  |                                                                                |

Indexes: `(conversation_id, started_at, id)` and a partial index on rows with `wanted = 'running'`.

Why not reuse a table. `run_commands` rows end with their run: a running row whose run ended reads as interrupted. `preview_servers` rows belong to a project and restart themselves. An agent terminal belongs to a chat, outlives its run and never restarts.

At startup every row still `starting` or `running` becomes `interrupted`, as `terminal_shells` is cleared today.

## Build plan

Small files, each under the 500-line limit. `terminal/sessions.ts` (483 lines) and `workflow/agent-turn.ts` (497 lines) are at the limit, so new behavior goes in new files. Lanes with the same number can run at the same time.

### Phase 1: mirror tab

| Lane | Owner    | Files                                                                                                                                                                                                                        |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a   | Web dock | `apps/web/src/terminal/dock/shell-store.ts` (tab kind replaces `preview`), new `dock/command-tabs.ts` (open and close a mirror tab), new `dock/CommandTab.tsx` (output view and Stop turn), `TerminalDock.tsx` (label, icon) |
| 1b   | Web chat | `apps/web/src/chat/commands/CommandTerminal.tsx` (Open in terminal button), `command-terminal.css`                                                                                                                           |
| 1c   | Docs     | `docs/guide/terminals.md`, `docs/guide/follow-a-turn.md`, `docs/guide/whats-new.md`, screenshots                                                                                                                             |

1a and 1b agree first on one function: `openCommandTab(chatId, runId, commandId)`.

### Phase 2: `spark_terminal_run`

Lane 2a goes first and is small. The rest run in parallel against it.

| Lane | Owner        | Files                                                                                                                                                                                                                                                                                    |
| ---- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2a   | Contracts    | new `packages/contracts/src/agent-terminal.ts`: row schema, states, event names, route request and response schemas                                                                                                                                                                      |
| 2b   | Persistence  | `apps/server/migrations/0162_agent_terminals.sql`, new `apps/server/src/persistence/agent-terminals.ts` (insert, ask stop, save state, save output, list for chat, mark interrupted)                                                                                                     |
| 2c   | Runner (API) | new `apps/server/src/terminal/agent-terminals.ts` (reconcile rows, spawn, replay, save tail, `view`), new `terminal/agent-terminal-routes.ts` (list, open view, stop), `api/main.ts` and `api/app.ts` wiring, startup and quit, `remote/route-rules.ts` (Mac-only)                       |
| 2d   | Gate         | new `apps/server/src/approvals/spark-command.ts` (pure: the `ApprovalRequest` for a Spark-run command, the secret-looking refusal), new `workflow/command-gate.ts` (hands the turn's gate to the Spark scope without the allowlist and run rules), `spark-mcp/deps.ts` (one scope field) |
| 2e   | Tool         | new `apps/server/src/spark-mcp/tools/terminal-run-tool.ts`, registration in `spark-mcp/server.ts`, `tool-selection`, `spark-mcp/guide/sections.ts`, audit entries, turn-stop hook in `workflow/stop-run.ts`                                                                              |
| 2f   | Web          | new `apps/web/src/api/agent-terminals.ts`, new `apps/web/src/chat/commands/AgentTerminalRow.tsx`, dock tab kind `agent` in `shell-store.ts`, close and stop confirm in `TerminalDock.tsx`, the end-of-turn line                                                                          |
| 2g   | Docs         | `docs/guide/terminals.md`, `spark-tools.md`, `guardrails.md`, `protected-paths.md`, `use-your-phone.md`, `whats-new.md`, `docs/architecture/SPARK_TOOLS.md`, `ACP_AGENTS.md`, `ACP_COVERAGE.md`, `AGENTS.md` (after approval)                                                            |

Seams between lanes: 2c and 2e meet only through the table and its NOTIFY. 2d gives 2e one function, `reviewSparkCommand(scope, command, cwd)`. 2f needs only the 2a schemas and the 2c routes.

## Test plan

Fakes only. No real provider sessions. The fake provider (`providers/fake-commands.ts`) gets one more trigger that calls the tool. The runner takes an injected spawn, like `PreviewRuntime`.

Unit:

- `apps/web/src/terminal/dock/command-tabs.test.ts`: open once per command, reopen focuses, close, a finished command loads its saved tail.
- `apps/web/src/terminal/dock/terminal-dock.test.tsx` (extend): tab kinds, the agent label and title text, keyboard order, Stop confirm, focus returns to the tab after "keep running".
- `apps/web/src/chat/commands/AgentTerminalRow.test.tsx`: each state's text, Stop, Open in terminal, the phone view has neither.
- `apps/server/src/approvals/spark-command.test.ts`: the request matches an agent's own command request field for field; secret-looking commands are refused.
- `apps/server/src/approvals/decide-spark-command.test.ts`: every mode posture; no allowlist or run-rule shortcut; each safety-floor rail asks or refuses in full access; publish rules for `git push` and `gh`; Ask turns refuse; the read-then-send note.
- `apps/server/src/terminal/agent-terminals.test.ts`: start, exit code, stop, replay to a late viewer, output tail cap, stop twice, a stop that races the exit, folder removed.
- `apps/server/src/spark-mcp/tools/terminal-run-tool.test.ts`: the four actions, another chat's terminal is not visible or stoppable, output is redacted and wrapped, no folder, read-only run.
- `apps/server/src/remote/` policy test: the new routes are Mac-only.
- `apps/server/test/spark-tool-budget.test.ts`: the plain-chat tool list does not grow.

Database (`pnpm test:db`):

- `apps/server/test/agent-terminal.db.test.ts`: the row life cycle; a duplicate `start` with the same tool call makes one row; restart marks running rows interrupted and starts nothing; deleting the chat stops and removes; stopping the turn stops only that run's terminals; a stale exit after a stop does not overwrite `stopped`.
- `apps/server/test/agent-terminal-gate.db.test.ts`: a card is raised in an asking mode and the command starts only after Allow; Reject and timeout start nothing; cancelling the turn while the card waits starts nothing; audit entries and the ran-without-review mark.

Browser (add both to `tests/browser/spec-map.ts`, group `terminal-preview-browser`):

- `tests/browser/command-terminal.spec.ts` (extend): Open in terminal shows the same output in a dock tab, live for a streaming fake, with the "shows when the command ends" note for a non-streaming one; Stop turn.
- `tests/browser/agent-terminal.spec.ts`: an agent terminal appears in the reply and the dock, labelled as the agent's; it keeps running after the turn ends; Stop from the tab and from the row; refresh reattaches with the kept output; the card flow; keyboard and focus; screen-reader status text. Tag the socket path `@packaged`.

Not verified by these tests: real adapter behavior. The claim that no adapter calls `terminal/create` rests on reading the pinned packages, and should be rechecked on each bump.

## Risks

- **New authority.** This is the first Spark tool that runs an agent-chosen command. A gap in the gate is a gap in the safety floor. The gate was written for commands the agent's sandbox or prompt also saw. Mitigation: one code path, the same `decide`, tests per rail, no input action.
- **Outside the Codex sandbox.** A Codex agent can ask for a command its sandbox would block, such as one that uses the network. The card says so, and shortcuts do not apply, but in Approve for me and Full access it runs at once.
- **The gate reads shell text.** It cannot see what a script file does when run. This is true of the agent's own commands today. A long-lived process makes it matter for longer.
- **A long-lived process changes after the decision.** A watcher runs whatever the files say later. The decision covered the command text at start.
- **Agents may overuse the tool.** If an agent uses it for every command, the user loses the agent's own prompt and the Codex sandbox for those commands. Mitigation: the description, and the stricter card rule makes it slower than the agent's own tool in asking modes.
- **Leftover processes.** A crash of the runtime can leave a process running. Startup marks rows interrupted but only kills what it can still find by pid and start time.
- **Output can hold secrets.** The tail is redacted like command output, but redaction only knows known values and patterns.
- **Two things called terminal.** A Terminal session is the user's and outside the safety floor. An agent terminal is inside it. The labels and the guide must keep them apart.
- **Mirror tabs disappoint for Claude.** Output arrives at the end. The tab says so, but it is less than the Claude desktop app shows.
- **File-size limits.** Two files this touches are at the 500-line limit. Splitting them is in scope only where a lane needs it.

## Owner approval needed

### Proposed AGENTS.md text

Add to the permissions paragraph, after the sentence about Spark action tools. Do not add it before phase 2 is approved. Phase 1 needs no AGENTS.md change.

> An agent may ask Spark to run one command in a Spark-owned terminal tab that keeps running after the turn (`spark_terminal_run`), in a chat with a project folder and never in an Ask or read-only turn: Spark judges it through the same approval gate as the agent's own commands, in every mode, so it runs at once in Auto, Bypass permissions, Approve for me and Full access and shows an ordinary approval card otherwise (Allow once or Reject only; the allowlist and run rules do not apply), the safety floor and the publish rules hold as they do for a solo Builder's own commands, a start that no card approved is marked ran without review, and each start and stop is an audit entry. Such a tab takes no input, is labelled as the agent's, stops when the user or the agent stops it, when the chat is removed or when Spark quits, is never started again by Spark, and is not a Terminal session; like Terminal, it stays on the Mac.

And one line for the product list near the Browser pane and phone bullets:

> Agent terminals are designed in `docs/architecture/AGENT_TERMINAL.md`. Read it before changing how Spark runs a command for an agent.

### Decisions

1. **Build order.** Recommended: phase 1 (mirror tab) now, phase 2 (`spark_terminal_run`) after this approval. Alternative: phase 1 only, and wait for an adapter that supports client terminals.
2. **Allowlist and run rules for Spark-run commands.** Recommended: they do not apply; the mode or a card decides. Alternative: pass the gate unchanged, so "always allow" entries start these commands without a card, outside the Codex sandbox.
3. **Stricter than the agent's own commands in Bypass, Approve for me and Full access.** Recommended: yes. A hard rail asks or refuses before a Spark-run command starts, where the agent's own command would only be flagged. Alternative: flag only, to match.
4. **Stopping the turn.** Recommended: stop the terminals that turn started and keep earlier ones. Alternatives: keep all running, or stop all of the chat's.
5. **Typing into an agent tab.** Recommended: no, read-only with Stop. Alternative: let the user type (never the agent). That would make part of the tab a user Terminal session, outside the safety floor.
6. **Who may use the tool in a crew turn.** Recommended: a solo Builder and the integrator only in the first version; pieces and the Coordinator get a refusal. Alternative: pieces too, under the same gate.
7. **How many at once.** Recommended: 4 running agent terminals per chat, counted apart from the user's 12 shells. This is a count, not a budget.
8. **Stop from the phone.** Recommended: no. The phone shows state as text only. Alternative: allow Stop behind a switch on the Phone page.
9. **Claude live output inside a turn.** Recommended: not now. Later, the AIR `asyncTasks` capability could give live output and per-command Stop for Claude background commands. It needs its own review.
10. **Tool name.** Recommended: `spark_terminal_run` with `action: start | status | output | stop`. `spark_terminals` stays the read-only list of the user's shells.
