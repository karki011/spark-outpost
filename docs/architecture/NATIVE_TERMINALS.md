# Native Terminal sessions

Terminal sessions run the installed Claude Code or Codex interactive CLI in a Spark-owned PTY. Chat sessions continue through ACP. Terminal sessions do not start Coordinator/Builder workflows and cannot switch a live Chat conversation into a native terminal.

## Ownership and lifecycle

The desktop starts an independent local runtime under the channel's app-data directory. That runtime owns embedded PostgreSQL, the Node API, and the workflow worker. Electron controls the windows and connects to this runtime over a Unix domain socket, `runtime/control.sock` (mode 0600) in the channel's private `runtime` directory (mode 0700), so only the same user can reach it. The host creates a new control token on every start (`runtime/token`, mode 0600) and records its pid and app version in `runtime/endpoint.json`; it removes a stale socket and endpoint on start after checking that no live host answers, and removes the endpoint and token on shutdown. The token never crosses the socket: the client sends a nonce, the host answers with an HMAC of the token over both nonces, the client verifies it and answers with its own, and the host serves no request before that. The API launch token stays in runtime memory and is read only over this proven connection. The host starts only the app's own API, worker and migration entries through its own `server-entry.js`; the server folder is fixed when the host is spawned. Service environments are passed through whole, because agents need the user's login-shell environment. Development and installed channels have separate directories and credentials. A data folder whose socket path exceeds 103 bytes is refused with an error.

On reconnect, Electron adopts a runtime of the same app version: its database port, API port, launch token, and running services. It does not migrate an already-running API or start duplicate agents. A runtime of a different app version, or one that reports no version, is replaced: Electron asks it to shut down over the proven connection (API and worker, their PTYs, then PostgreSQL), waits up to 30 seconds for the process to exit, then starts a host of the current version and continues the normal start, migrations included. A host that does not answer, such as one from the earlier loopback protocol or one that ignored the request, receives SIGTERM (the same ordered shutdown) and after another 30 seconds SIGKILL, but only when the recorded pid is a `runtime-host.js` process started for this runtime directory; any other process is left alone. Native terminal processes in the replaced runtime are lost; the new API records them as interrupted in its startup recovery (`nativeTerminals.recover()`). Normal updates still use explicit shutdown before restarting the updated app; replacement covers a runtime left headless by a crash, a force quit or an update.

| Event                                                        | Terminal behavior                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Hide a terminal, close a window, refresh, or lose its socket | PTY continues; a fresh one-use attach token reconnects to the same process                 |
| Electron renderer or main-process crash                      | Runtime and services continue; reopening reattaches                                        |
| Explicit Quit                                                | Services stop, managed PTYs stop, grants are revoked, then PostgreSQL stops                |
| API/runtime failure or Mac restart                           | Session history remains; running state is reconciled as interrupted and resume is explicit |
| Native CLI exits                                             | Session records its exit and does not restart automatically                                |
| Provider reports `SessionEnd` (`/clear`, `/resume`, logout)  | PTY continues; an open turn closes; the next `SessionStart` may carry a new session ID     |
| Launch fails before the agent starts                         | Run fails with the reason; a plain launch starts again with the saved first message        |
| Dock shell (not an agent) loses its socket                   | Shell ends; only agent sessions are kept for reattachment                                  |
| Reopen with another app version after a crash or update      | The earlier runtime is shut down and replaced; its sessions are reconciled as interrupted  |

Only the PTY's own exit marks a session exited. A provider `SessionEnd` hook is an observation: Spark closes the open turn as outcome unknown, records the provider's reason when it is a plain token, and keeps the process. After a `SessionEnd`, the next `SessionStart` from the same hook credential and generation may replace the recorded provider session ID; any other event carrying a different session ID is refused.

A provider session ID is accepted from a hook only when it is 1–100 letters, digits, `_` or `-` and does not start with `-`. It is checked again when the resume command line is built, so a stored value can never be read as an option. Anything else is refused and not stored.

A session with no provider session ID has nothing to resume. When its launch failed (terminal limit, CLI probe, worktree), its run is failed with the reason and a plain launch is allowed again: the saved first message's run is re-queued, and the session view offers Start again. A launch the user stopped stays cancelled. Startup recovery fails Terminal runs that were queued but never launched, so they do not count as active work.

An attach token is single-use: after its socket disconnects, reattaching needs a token newly issued by the authenticated attach route. Agent sessions keep a replay buffer; ordinary dock shells end when their socket closes.

Terminal output replay is bounded to 256,000 JavaScript characters in memory. It is not a durable terminal transcript. Reattachment preserves a running process; provider-native resume creates another process from provider history and does not restore an interrupted shell command exactly.

Spark manages only its own child processes and recorded session IDs. It never adopts or kills an external terminal by executable name. PTYs start in the session's project workspace; a working directory does not provide a filesystem sandbox. Native CLI permission modes continue to govern native execution.

## Tools and observation

With Use Spark workflow enabled, Terminal agents receive a revocable session-scoped Spark MCP grant and prepared task context. Turning it off omits Spark tools and workflow prompts from new launches. Custom instructions remain available in either mode. Spark tools use the existing backend permissions, confirmations, audit, and run events. The native interface owns native questions and permission prompts; Spark action confirmations remain Spark cards.

Native commands run outside Spark's command gate. Terminal sessions do not run automatic separate publish turns or automatic PR follow-up turns; the native agent owns that interaction. The Chat-only autonomy control is omitted from Terminal sessions. Automatic Full auto → PR remains a Chat workflow feature.

Provider-specific launch adapters supply hooks and MCP configuration for the individual launch without rewriting global CLI settings. Hook events are authenticated, scoped to the session and generation, and treated as observations. They never grant authority. Compatibility is verified through isolated CLI capability probes rather than an exact version allowlist. Missing observations show Open rather than inferring idle from terminal silence.

Spark tool permissions never exceed the mode selected at launch, even if a hook reports a broader native mode. Until a recognized permission observation arrives, Spark tools remain read-only. Widening Spark tool permissions requires a new session with the intended launch mode.

The terminal view and Island share a session identity and activity state. The terminal companion stays outside PTY output, does not intercept typing, and honors reduced motion.

The Browser bridge is forwarded independently for the API and worker while a desktop is attached. Pending and new Browser requests fail explicitly when the desktop disconnects; background non-Browser work can continue. Reopening restores the bridge. Terminal and native-terminal routes are refused by the phone gateway, including Terminal creation through otherwise-shared conversation and ticket endpoints.

## Validation boundaries

`runtime-client.test.ts` exercises real detached host processes in temporary directories: socket and token permissions, token rotation, a stale endpoint and socket taken over by another listener, connections without proof, a controller killed with SIGKILL, identity adoption, explicit shutdown of owned children, replacement of a host of another version, without a version, or of the earlier loopback protocol, and refusal of entries outside the app. `runtime-retire.test.ts` covers the pid identity check and the SIGTERM and SIGKILL fallback against fixture processes. Replacement after a real auto-update or a crash of the packaged app has not been exercised. `agent-sessions.test.ts` exercises immediate native spawn, duplicate launch prevention, bounded replay, fresh tokens, stale attachment handling, and exit reporting. Existing setup terminal tests retain their disconnect/timeout behavior. `native-terminal-runtime.db.test.ts` checks real authenticated hook HTTP, native MCP calls and backend confirmations, cancellation/resume fencing, and eight simultaneous fixture sessions. These use a fake PTY and do not measure live provider performance.

These checks do not establish native packaged Electron crash acceptance, embedded-PostgreSQL survival under every OS termination scenario, or live Claude/Codex activity delivery. Provider claims remain tied to adapter contract tests, local capability probes, and explicit live acceptance. Release validation must exercise the packaged application, actual provider prompts and approvals, interrupted recovery, and 5–10 concurrent sessions.

If PostgreSQL is unavailable while the native process exits, durable exit status may require service restart reconciliation. Process cleanup and grant revocation still proceed.

## Implementation record — 2026-10-08

Implemented separate Chat/Terminal creation, ticket handoff, private native launch configuration, session-scoped Spark tools, observed activity, the shared terminal companion, detached runtime ownership, explicit stop/resume, and Mac-only route policy. Terminal sessions retain the native provider interface and do not start a Coordinator/Builder crew.

The production-origin browser suite passed three Terminal scenarios, including a real fixture PTY retaining its PID, input and replay across hide/reopen and page reload, and explicit hold-to-stop. Two existing packaged-origin Codex setup/login regressions passed. Native runtime database tests passed eleven scenarios, including eight concurrent fixture sessions, pending-launch cancellation, provider mismatch, duplicate/stale events, and PostgreSQL failures followed by completion retries and later prompts. An independent review found no remaining actionable issues after the fixes; its database rerun covered the ten scenarios present before the final completion-transaction regression.

Final repository validation: `pnpm check` passed, including 6,021 unit tests in 716 files, formatting, lint, all workspace typechecks, source and guide rules, model cards, unused-code checks, contrast, and ACP coverage. The focused database run passed 90 tests across eight files covering native persistence/runtime, MCP, phone policy, PR follow-up, tickets, cancellation, and reset. The full database and browser suites were not run; they remain required before merging or release.

No live provider turn or packaged Electron crash acceptance was performed. Automatic publish turns remain a Chat feature. The only new code-comment exceptions are the machine-consumed Vitest jsdom environment directives in the terminal UI and drop test files.

### Desktop testing follow-up

The launch UI now uses a compact session switch and agent menu. Chat and Terminal share the project menu, recent folders, folder browser, linking, and focus restoration; launch retains every linked project. The launch form stays mounted while creation/settings/launch requests finish. Empty launch requests join a pending startup, and attachment waits for the original PTY instead of reporting that the terminal is already starting.

Validation passed: eleven focused UI/project unit tests, twelve native runtime database tests, seven production-origin browser scenarios covering both Chat and Terminal folder selection, delayed folder linking, failed creation, and native startup/reattachment, web/server typechecks, focused lint, source rules, and guide rules. The legacy Chat folder-navigation case exceeded its default 30-second timeout while traversing the Mac's temporary directories; all six browser scenarios passed with a 60-second timeout. A follow-up independent review found no remaining actionable issues after folder-mutation submission guards and failed-creation unlocking were added. The desktop renderer was refreshed without stopping the user's services. Server changes load on the next app restart; the current running services were preserved.

### Terminal interaction follow-up

Terminal titles now keep their marker and title on one line. Detailed activity and lifecycle guidance moved into the keyboard-accessible Terminal help tooltip. Interactive PTYs remove inherited color overrides such as `NO_COLOR=1`, retaining `TERM=xterm-256color` and `COLORTERM=truecolor`; current processes need a service restart and a fresh launch to receive the environment change.

File and directory drops use Electron's existing original-path resolver and Xterm paste, with every path quoted, apostrophes escaped, and control characters rejected. A drop never adds Enter. Terminal events are consumed before Chat's attachment handlers; input errors show a notice without marking an open connection disconnected. Original local paths are available only in the desktop app.

Phantom was inspected at remote commit `15e59215d8504ec6c31f523804912fb669654fbb`: `GhosttyTerminalSurface.swift` inserts native file URLs; its private `phantom-sessions` tmux server supplies a separate process-persistence layer. Spark retains its existing daemon architecture in this change. Unlike tmux-owned PTYs, its native processes do not survive a runtime service failure.

Validation passed: 30 focused unit tests, web/server typechecks, targeted lint, formatting, source and guide rules, and one production-origin browser scenario using a real fixture PTY. That scenario verifies multiple quoted file/folder paths, no automatic Enter, nonfatal rejected drops, title alignment, help tooltip, ANSI color, PID/input/replay retention, and explicit stop. Electron's path resolver is stubbed in that browser test; a real Finder drop and live-provider compatibility remain manual acceptance. A final independent review found no remaining actionable issues after input-error and dragleave fixes. The web and desktop bundles were rebuilt without restarting user services; renderer refresh was deferred because native UI automation detected concurrent user interaction. The new machine-consumed comment directive is the jsdom test environment declaration in `terminal-drop.test.ts`.

### Workflow settings and activity follow-up

Settings now reuses Use Spark workflow for Chat and Terminal, with advanced workflow controls under Workflow options. Custom instructions combine optional text with an optional local UTF-8 file, read again when preparing a session. Migration 0153 stores the text and path; file contents are not copied into the profile response. File validation rejects secret paths, invalid encoding, non-regular files, and files over 16 KB. Phone clients can update instruction text but cannot set a local file path.

Terminal launches pass custom instructions through the provider's instruction configuration, including explicit resume. Claude resume disables its saved system-prompt snapshot when applying or clearing current instructions; an older CLI without that capability requires a new session. Turning workflow off removes Spark's MCP configuration and task-context prompts while retaining native activity observation. Existing processes and prior provider history are not rewritten.

Claude hook events and Codex session hooks are checked with isolated, bounded CLI diagnostics. Checks are cached by executable and reported version for the life of the service, including failed ones; a check the caller aborted is retried. Local Claude 2.1.294 and Codex 0.153.4 accepted the required hook configuration. Claude prompt IDs fence stale activity, and elicitation and permission events distinguish waiting from running. The UI shows Running, Idle, Waiting for input, Waiting for permission, or Open when detailed activity is unavailable. Terminal borders and the previous help guidance have been removed.

The Island rests as blobs at every size and opens on hover, click, or an explicit action. It defaults to the primary display and retains a chosen docking position across ordinary disconnect/reconnect, with existing all-Spaces and fullscreen window behavior preserved. Position restoration uses display coordinates; rearranging displays or changing resolution may require repositioning.

Validation passed: the full `pnpm check`, including 6,043 unit tests in 719 files; 36 focused setup/instructions/native-runtime database tests; 21 remote-policy database tests; five settings/native-terminal browser scenarios, with the compaction case passing after updating it for the collapsed controls; 12 packaged Island browser scenarios and 23 additional Island regressions. The final custom-instructions browser rerun also passed. Native launch tests cover applying and clearing instructions on resume. No live provider turn, real Finder drop, physical multi-monitor/Spaces acceptance, or packaged Electron crash test was performed. Full database and browser suites remain required before merging or release.

The build preserves currently running services and terminals. The updated API, runtime, hooks, and native window behavior load after an explicit app Quit/reopen; activity hooks require a new or explicitly resumed terminal process. No new explanatory code comments were added.

### Review follow-up

Terminal sessions have no Spark safety floor: the provider's CLI runs under the agent's own permission mode, and Spark's approval cards, protected-path rules and ran-without-review audit do not apply inside the PTY. Spark records that the session started, its mode and its observed state. The owner chose to document this rather than build a floor; AGENTS.md and the guide say so.

Runs of a Terminal session are recorded at the non-publishing level (`hands-off`) whatever the profile default is, so the Spark MCP scope has publish authority only when the user's message asks for it or the agent's mode would run it. A Terminal conversation with no terminal row and no messages is a draft: the app shows the new-session picker again, and the chat list and pruning treat it like an empty chat.

An instruction file that can no longer be read does not fail a run: preferences load without its text, a chat run records one note with the reason, and the profile reports the reason for Settings. A Terminal launch goes on without the text but records no note yet. The file check refuses credential locations by full resolved path, and a paired phone sees that a file is set but not its path.

See [Electron plan](ELECTRON_PLAN.md), [protocol alignment](PROTOCOL_ALIGNMENT.md), and [phone remote access](PHONE_REMOTE.md).
