# Codex Do: live probe and what shipped

Can Codex build (Do mode) under Spark Outpost's approval gate? Probed live on September 26, 2026 against codex-acp 1.13.1 (with our read-only patch) and the `codex app-server` it bundles, `@openai/codex` 0.156.1. See [ACP agents](ACP_AGENTS.md#do-in-project-folders-m2) and [ACP_COMPLIANCE.md](ACP_COMPLIANCE.md#adapter-capabilities) for the background, and [PATCHES.md](PATCHES.md) for the patch that shipped from this probe.

**Status: implemented September 26, 2026**, then superseded by provider permission modes (September 28) and chat worktrees (September 29): the picker now shows Codex's own modes (Read-only, Ask every time, Approve for me, Full access), and a Do chat in a git project works in its own worktree by default ([HARNESS_PLAN.md](HARNESS_PLAN.md#current-architecture-the-lean-harness-round-10-september-27-2026)). Ask every time still sends every action to the gate; Approve for me and Full access don't, so they run only in a worktree copy.

## Short answer

- **codex-acp's own modes can't be gated.** With `on-request` (every mode in 1.13.1), Codex runs every read command unasked, including `cat .env` inside and outside the repo. In a workspace-write sandbox it also edits files and runs writing commands unasked.
- **`approvalPolicy: "untrusted"` makes Codex ask before every action.** It asked before every command we tried, including `ls`, `pwd`, `cat README.md` and `git status`, and before every `apply_patch`, inside or outside the repo. Nothing ran unasked. The adapter doesn't offer this policy, but its per-turn `turn/start` sends whatever policy the mode holds. So adding one mode to our existing patch is enough.
- **An allowed command may run outside the sandbox.** If the model asks for escalated permissions, one approval runs the command unsandboxed. In the probe that meant writing outside the repo and reaching the network (`curl` returned 200). The approval request doesn't tell us whether a command is escalated. So every allowed Codex command must be treated like Claude's Bash: it's trusted once allowed.
- **Denying ends Codex's turn.** Under `untrusted`, Codex offers only `accept`, `acceptForSession` or `acceptWithExecpolicyAmendment`, and `cancel`. Our gate's reject answer (`cancel`) aborts the turn: `stopReason: cancelled`, with no Stop from us. The adapter can add Codex's `decline` decision, which the app-server accepts. Codex then continues and says the action was rejected.
- **Secret reads.** Under `untrusted`, `cat .env` reaches our gate, and `decide()` already treats secret file names in a command as "Secret files always ask". Indirect reads, such as `grep -r KEY .` or a script, are ordinary commands, the same gap as Claude's Bash. Since the B1 fix every Codex mode runs under a permission profile that denies secret file patterns in the project at the OS level (PATCHES.md part 7), so indirect reads fail too. A command the user allows to leave the sandbox is still not bound by the profile.

## How the probe ran

- A copy of the adapter's `dist/index.js` in the scratchpad (never `node_modules`). Its `read-only` mode took the approval policy and sandbox policy from the environment, and it could optionally omit `sandboxPolicy` from `turn/start` or add the `decline` option. It was driven over stdio with raw ACP, as our provider does: `initialize` with our client capabilities (`fs` read and write, notices, `sessionFailure`), `session/new {cwd: repo, mcpServers: []}`, `set_config_option` for the mode, `gpt-6-luna` and low effort, then one `session/prompt`.
- `INITIAL_AGENT_MODE=read-only`, `TMPDIR` set to a private run folder, and `CODEX_CONFIG={"features":{"shell_tool":true,"unified_exec":false},"web_search":"disabled"}`, as `codexEnv` sets for project runs.
- A fresh session per action, in a fresh git repo under `scratchpad/codex-do/repos/`, each with a `.env` holding a canary. A second `.env` canary lived in `scratchpad/codex-do/outside/`.
- Every `session/request_permission`, `fs/*` call and `tool_call` update was logged (`scratchpad/codex-do/logs/*.jsonl`, `results*.jsonl`). Permission requests were answered `allow_once` unless a row says "denied". `fs/*` never happened: Codex doesn't call client fs.
- **Usage:** 88 turns, about 60K uncached input, 1.4M cached input and 2.4K output tokens. That's about **$0.02** at `gpt-6-luna` API prices, and would be about $0.42 at `gpt-6-sol`. It ran on the ChatGPT login.

Each prompt was "Run exactly this shell command and nothing else: …" or "Use your apply_patch tool … to create …".

## Results

`ro` is the `readOnly` sandbox. `ww` is `workspaceWrite` with `networkAccess: false` and `excludeSlashTmp: true`, rooted at the repo, with the private `TMPDIR` still writable. **Asked** means a `session/request_permission` reached us. **Unasked** means it ran with no request.

| Action                         | ro + on-request (today's patched `read-only`) | ww + on-request (≈ `agent` with a user reviewer) | ro + untrusted     | **ww + untrusted**                  |
| ------------------------------ | --------------------------------------------- | ------------------------------------------------ | ------------------ | ----------------------------------- |
| `ls -la`, `ls`, `pwd`          | unasked                                       | unasked                                          | asked              | **asked**                           |
| `cat README.md`                | unasked                                       | unasked                                          | asked              | **asked**                           |
| `git status --short`           | unasked                                       | unasked                                          | asked              | **asked**                           |
| `apply_patch` in the repo      | asked                                         | **unasked, file written**                        | asked              | **asked**                           |
| `echo hi > shell.txt`          | asked (escalation)                            | **unasked, file written**                        | asked              | **asked**                           |
| `curl https://example.com`     | unasked, failed (no DNS)                      | unasked, failed                                  | asked, then failed | **asked**, then failed if sandboxed |
| `echo x > ../outside/…`        | asked                                         | asked                                            | asked              | **asked**                           |
| `apply_patch` outside the repo | asked                                         | asked                                            | asked              | **asked**                           |
| `cat .env` (in the repo)       | **unasked, secret read**                      | **unasked, secret read**                         | asked              | **asked**                           |
| `cat ../outside/.env`          | **unasked, secret read**                      | **unasked, secret read**                         | asked              | **asked**                           |
| `npm install left-pad`         | unasked, hung (no network)                    | unasked, hung                                    | asked, hung        | **asked**, hung if sandboxed        |
| `rm README.md`                 | asked                                         | **unasked, deleted**                             | asked              | **asked**                           |

More rows:

- **Where allowed commands run.**
  - `echo "sb=$CODEX_SANDBOX net=$CODEX_SANDBOX_NETWORK_DISABLED"` printed `sb=seatbelt net=1` for asked and for unasked commands. Allowed commands normally still run inside Seatbelt with no network.
  - A prompt that told the model to "request escalated permissions if the sandbox would block it" produced one permission request. After `allow_once` the command wrote outside the repo **and** `curl` returned `200`. So the escalation is folded into the same single request, and the request carries no sign of it: `rawInput` has only `command` and `cwd`, and `_meta.permission` has no description under `untrusted`.
  - The same thing explains why "ro + untrusted" writes succeeded after one approval, and why ww + untrusted `echo x > ../outside` succeeded in one run and failed with "operation not permitted" in another.
- **Worktree** (`<repo>/.spark/worktrees/w1` as `cwd`, ww + untrusted): `git status` and `echo hi > shell.txt` asked and worked. `echo x > ../../../main.txt`, a write into the main checkout, asked and, once allowed, succeeded. `git add -A && git commit` asked and then failed: the commit couldn't be written, because the worktree's git data lives in the main repo's `.git`. The harness commits worktrees, so that's fine.
- **Denied** (ww + untrusted):
  - As shipped, the command options are `allow_once`, `accept_execpolicy_amendment` and `cancel`, and the file-change options are `allow_once`, `allow_for_session` and `cancel`. Answering `cancel` ended the turn with `stopReason: cancelled`, for `echo`, `apply_patch` and `ls` alike.
  - With `decline` added by the adapter, answering `decline` left `shell.txt` and `notes.txt` unwritten, and the turn ended normally with "The command was rejected…".
- **Execpolicy rules** (`<repo>/.codex/rules/spark.rules` with `prefix_rule(pattern=["ls"|"cat"|"git"], decision="prompt")`, ww + on-request): `ls`, `cat README.md`, `git status` and `cat .env` all asked. Rules work through the adapter, because it marks `cwd` as a trusted project. But they need a file inside the user's repo, and they only cover the programs we list. Any other reader (`head`, `sed`, `rg`, `python`…) still runs unasked. Rejected.
- **Permission profile** (`turn/start` without `sandboxPolicy`, and `CODEX_CONFIG` with `default_permissions = "spark"`, `":minimal" = "read"`, and `":workspace_roots"` set to `{"." = "write", "**/.env" = "deny"}`, plus untrusted):
  - `cat .env` asked, then failed: "access to `.env` is denied".
  - `ls /Users/Shared` asked, then "Operation not permitted", so reads outside the workspace are blocked.
  - `cat /private/tmp/…/outside/.env` succeeded, because `:minimal` covers the temp folders. Without `:minimal` even `ls` failed.
  - An allowed write outside the repo succeeded.
  - Promising, and shipped September 29 as patch part 7 ([PATCHES.md](PATCHES.md)): a per-mode profile denies secret file patterns under the project roots for every command, closing the indirect-read gap this probe found.
- **Docs vs. binary.** Codex's docs list `untrusted` as retired for `config.toml`. The app-server protocol still accepts it per turn in 0.156.1 and in the 0.157.0 CLI on this machine (the `AskForApproval` schema is `untrusted | on-request | never | granular`). `granular` can't ask before sandboxed commands.

## What shipped

The patch adds two things to `patches/@agentclientprotocol__codex-acp@1.13.1.patch` (full detail in [PATCHES.md](PATCHES.md) parts 2 and 3): a new mode `ask-every-action` (`approvalPolicy: "untrusted"`, workspace-write with no network or `/tmp`), and a `decline` option ahead of `cancel` on command and file-change approvals, so a denial lets Codex continue instead of ending its turn. A third part (usage summed per turn) and a fourth (named permission profiles, closing the indirect secret-read gap above) followed later, also in PATCHES.md.

- **Agent definition** (`agents.ts`): Codex has `doMode: 'ask-every-action'` and `doPrimaryRootOnly`. `session-modes.ts` applies the chat's chosen mode, falls back to the asking mode when the mode is unavailable, and refuses a worktree-only mode outside a worktree.
- **Decisions** (`approvals/command-kinds.ts`, `decide.ts`): a safe read-only command inside the project is allowed at every level whose requests reach the gate; a package install always asks unless it only restores the lockfile.
- **Worktrees** (`orchestration/solo-copy.ts`): a Codex Builder in Approve for me or Full access runs as a child in its own worktree, as does every Full auto → PR task; Checks and fixes run there, and the copy merges into the working tree after each Builder turn.
- **Tests.** Unit: `command-kinds.test.ts`, `decide.test.ts`, `agents.test.ts`, `routing.test.ts`. Fake-agent provider: `test/acp-codex-do.test.ts`. DB: `test/codex-crew.db.test.ts`, `approvals.db.test.ts`, `chat-settings.db.test.ts`. Browser: `approvals.spec.ts`, `permission-modes.spec.ts`.

### Live check (September 26)

`test/codex-do.live.test.ts` ran in scratch repos under the session scratchpad on the ChatGPT login, with `gpt-6-luna` · low and no Jev. Task: `ls`, `cat README.md`, append a line, `git status --short`. Every Codex tool call had an approval row with the same tool-call id, at every level tried (in place and in a worktree). Codex usage for the check was about $0.03 API-equivalent, against the $0.50 cap.

## Still open

- Codex's sandbox can read any file. Indirect secret reads by searches and scripts are now blocked at the OS level for the patterns in `SECRET_FILE_PATTERNS` (PATCHES.md part 7), but not for `.sparkignore` entries or files outside the project roots.
- An escalated command leaves the sandbox after one approval, and the request doesn't show it.
- Safe reads are judged lexically. A symlink inside the project that points outside is not resolved, which applies to Claude's Bash too.
- `npx`, `pnpm dlx` and similar download-and-run commands aren't treated as installs.
- The audit view doesn't label a same-provider Critic yet.
