# Codex Do: live probe and proposal

Can Codex build (Do mode) under Spark Outpost's approval gate? Probed live on September 26, 2026 against codex-acp 1.13.1 (with our read-only patch) and the `codex app-server` it bundles, `@openai/codex` 0.156.1. See [ACP agents](ACP_AGENTS.md#do-in-project-folders-m2) and [agent adapters](AGENT_ADAPTERS.md) for the background.

**Update, September 28, 2026: provider permission modes.** The picker now shows Codex's own modes (Read-only, Ask every time, Approve for me, Full access); the chat's mode decides what Codex asks, and the harness autonomy (Review each step, Automatic, Full auto → PR) decides the rest ([HARNESS_PLAN.md](HARNESS_PLAN.md#provider-permission-modes-september-28-2026)). Ask every time still sends every action to the gate and may run on the checkout. Approve for me and Full access don't reach the gate, so they run only in a worktree copy, and a live switch to them on the checkout is refused. Ask before edits maps to Ask every time, Auto-edit and Full auto to Approve for me.

**Update, September 29, 2026: chat worktrees.** Every Do chat in a git project now works in its own worktree on its own `spark/…` branch by default ([HARNESS_PLAN.md, Chat worktrees](HARNESS_PLAN.md#current-architecture-the-lean-harness-round-10-september-27-2026)). That worktree counts as the worktree for `modeNeedsWorktree`: Approve for me and Full access run in it directly, with no extra per-run copy and no merge back into your checkout. The per-run copy described below still applies when you choose "Work in my checkout" or the chat works on your checked-out branch in place.

**Status: implemented September 26, 2026.** The user approved the proposal with two changes: safe reads use the same rule for every provider, and package installs always ask for every provider unless they only restore the lockfile. What shipped and the live check are at the end.

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
  - It's promising but not ready:
    - Omitting the per-turn policy lets `~/.codex/config.toml` apply. The user's has `sandbox_mode = "danger-full-access"` and `approval_policy = "never"`, so a profile that fails to load fails open.
    - Escalated commands bypass it.
    - The docs report deny globs broken on some versions ([openai/codex#22179](https://github.com/openai/codex/issues/22179)).
- **Docs vs. binary.** Codex's docs list `untrusted` as retired for `config.toml`. The app-server protocol still accepts it per turn in 0.156.1 and in the 0.157.0 CLI on this machine (the `AskForApproval` schema is `untrusted | on-request | never | granular`). `granular` can't ask before sandboxed commands.

## The patch (in `patches/@agentclientprotocol__codex-acp@1.13.1.patch`)

What each part changes, what guards it and when it can go is tracked in [PATCHES.md](PATCHES.md).

About 25 changed lines in `dist/index.js`, prototyped in `scratchpad/codex-do/proposed-patch-addition.diff` and checked live: `ls`, `apply_patch`, `cat .env` and an outside write all asked, and a denied `echo` failed while the turn ended normally.

1. **New mode `ask-every-action`** ("Ask every time"): `approvalPolicy: "untrusted"`, `approvalsReviewer: "user"`, `workspaceWrite` with `writableRoots: []`, `networkAccess: false`, `excludeSlashTmp: true` and `excludeTmpdirEnvVar: false`. The private `TMPDIR` stays writable, but not `/tmp`. It's added to `AgentMode.all()`, and the other modes are unchanged.
2. **`decline` option.** `decline` ("No, continue without it", `reject_once`) is added to command and file-change approvals when Codex doesn't offer it, placed before `cancel`, so our gate's first `reject_once` means "skip this and carry on" instead of ending the turn.
3. **Usage per turn** (added September 27). codex-acp answers a prompt with the usage of the turn's last model request only. The patch sums the turn's requests from `thread/tokenUsage/updated` (the change in the thread total, or the last request when no total was seen yet, so repeated updates add nothing) and reports that sum. Input is still reported without its cached part, so the harness adds the cached tokens back before estimating the cost.

Maintenance:

- The patch touches three code blocks for the mode and the `decline` option, plus the token-usage handler, the turn start and the prompt responses for usage.
- A unit test fails if the mode or the `decline` option is missing, like today's read-only check.
- Upstream PR #480 (a `workspace-write` mode) doesn't replace it: that mode is still `on-request`. The patch can go only when codex-acp ships an "ask for everything" mode and a continue-on-deny option. Both are worth an upstream issue.
- Risk: a future Codex drops `untrusted` from the protocol. Pin `@openai/codex` through codex-acp's exact version, and add a live test that fails if `ls` stops asking.

## Proposal: Codex Do by involvement level (September 26; superseded by provider modes)

Codex Do runs in the `ask-every-action` mode, and every command and patch reaches `decide()`. The levels then mean the same as for Claude. Differences (level names as of September 26; the update at the top describes today's modes and autonomy):

| Level     | Codex Do                                                                                   | What Codex asks (picker copy)                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hands-on  | Supported                                                                                  | "Codex asks before every command, including reading files with `ls` or `cat`, and before every edit."                                                                                |
| Balanced  | Supported. Safe read commands in the project are allowed (see below); everything else asks | "Codex reads project files without asking. It asks before every edit and every other command, unless the command is on this project's allowlist."                                    |
| Hands-off | Supported, in a worktree                                                                   | "Codex reads and edits in a separate copy without asking. It asks before commands that aren't on the allowlist. You keep or revert the copy at the end."                             |
| Full auto | Supported, in a worktree                                                                   | "Codex works in a separate copy without asking, except for pushing, deleting outside the repo and secret files. An allowed command may leave Codex's sandbox and reach the network." |

Guardrails:

- **Safe reads.** Codex has no file-reading tool: its reads are commands. Claude's Read, Glob and Grep never ask at any level. For Codex, Balanced and above auto-allow a command only when our own classifier (`approvals/commands.ts`, not Codex's parse) finds all of these:
  - a single simple command from a fixed read-only list (`ls`, `cat`, `head`, `tail`, `wc`, `pwd`, `rg`/`grep` without `--pre`, `find` without `-exec`/`-delete`/`-fprint`, `git status|diff|log|show|branch`, `sed -n` without `w`)
  - no redirects, pipes into writers or substitutions
  - every path inside the roots
  - no secret names (these already always ask)

  Hands-on asks for these too. This also closes the direct `cat .env` path: it always asks.

- **Always a worktree at Hands-off and Full auto.** There, allowed commands run without a person looking, and an allowed command can leave the sandbox. The worktree keeps changes out of the main checkout until Keep. Hands-on and Balanced may run in place, where the git snapshot plus Keep or Revert cover it, as for Claude. Simplest option: always a worktree for Codex Builders. It costs a worktree even for one-step work, and ignored files (`node_modules`, `.env`) are missing, so checks that need them fail. That's a plus for secrets, a minus for checks.
- **Network off.** The sandbox default. The card says: "Runs in Codex's sandbox without network. If Codex asked to leave the sandbox, allowing it also allows network and writes anywhere." Package installs hang when sandboxed. Proposed: add "Installing packages always asks" (`npm|pnpm|yarn|bun install|add`, `pip install`, `brew install`, `cargo add|install`, `go get`) to `alwaysAskReason`, for every provider.
- **Writes and non-safe commands reach our gate.** Verified above. As a backstop, the provider stops a Codex Do run whose applied mode isn't `ask-every-action`, which the existing mode lock and `unsafeModeChange()` already do.
- **Deny.** With the `decline` option the turn continues, as with Claude. If the patch loses `decline`, a Codex turn ending `cancelled` without our Stop becomes "Codex stopped after a denied action" (finished, not cancelled).
- **Checks, Critic and Keep/Revert afterwards,** unchanged. The Critic sees the diff and the check results.
- **Disclosure** in the picker, Settings and the first approval card of a Codex Do run: "Codex can read any file on this computer inside its sandbox. Spark Outpost asks before each command that names a secret file, but can't see what a script or search reads. Its sandbox is not limited to this project for reads."
- **Extra repos.** `additionalDirectories` become writable roots under `workspaceWrite`. Pass only the primary repo, or the worktree, to Codex Do. Extra repos stay read context through the prompt, and the note says Codex can only change the primary repo.
- **Ask stays** on the patched `read-only` mode (unchanged). Chat stays on today's lockdown.

## Proposal: Codex as the only provider

- **Builders:** Codex in `ask-every-action` at the chat's level, as above.
- **Scout:** Codex in Ask (patched `read-only`), as today.
- **Architect:** Codex in Ask, at the top Codex tier and high effort unless pinned (`tiers.ts` already ranks the Codex models). Codex sends ACP `plan` updates from its plan tool, and the numbered-list fallback covers a missing plan. Claude's task tools aren't needed.
- **Critic:** `criticProvider()` already falls back to the chat's provider when no other one is connected. Changes:
  - Prefer a different model than the Builder's: a higher tier or effort.
  - Label it "Review by Codex (same provider, no cross-model review)" on the crew block, in the review artifact and in the audit view.
  - Keep "AI review, not verification".
- **Jev** routes among Codex's models only. Intake, gating and checkpoints are unchanged.
- **Mixed crews:** with Claude or Z.ai also connected, Builders stay on the chat's provider, and the Critic stays the first other connected provider.
- **Setup:** a user with only Codex connected gets Do in the picker, with the disclosure, instead of today's "Use Claude for Do".

## What shipped

- **Patch.** `ask-every-action` and the `decline` option, as above. `agents.test.ts` fails if the read-only sandbox, the new mode's policy and sandbox, or the `decline` ordering is missing.
- **Agent definition** (`agents.ts`): Codex has `doMode: 'ask-every-action'` (its asking mode) and `doPrimaryRootOnly`. Claude and Z.ai keep `doSessionMeta`, and `supportsDo()` covers both. `session-modes.ts` applies the chat's chosen mode, falls back to the asking mode when the mode is unavailable, and refuses a worktree-only mode outside a worktree (`modeNeedsWorktree`).
- **Decisions** (`approvals/command-kinds.ts`, `decide.ts`): `isSafeRead` and `isPackageInstall`, for every provider. A safe read is allowed with the reason "a read-only command inside the project" (`decided_by = 'level'`) in every mode whose requests reach the gate. An install asks with "Installing packages always asks" at every level, ahead of run rules and the allowlist.
- **Worktrees** (`orchestration/solo-copy.ts`): a Codex Builder in Approve for me or Full access (including a retry or fix) runs as a child in its own worktree, as does every Full auto → PR task. Checks and fixes run there. The copy is merged into the working tree after each Builder turn (since round 10, a conflict with your own edits offers Keep your version, Keep Bolt's or Stop; there is no reconciling Builder) and removed before the turn finishes. Keep or Revert covers it through the orchestration snapshot. The same copy now also serves destructive work and a second task running in the same repo.
- **Single-provider crews.** `ruleCriticPick` gives a same-provider Critic the tier above the chat model at high effort. `sameProvider` is recorded on the Critic's route and review body. The crew block reads "Critic (same provider, no cross-model review)".
- **Copy** (`packages/contracts/src/approvals.ts`):
  - `commandSandboxNote(provider)` replaces "Commands aren't sandboxed" on Codex command cards. The per-level hints and the picker disclosure went with the provider-modes picker, which shows Codex's own mode descriptions.
- **Tests.**
  - Unit: `command-kinds.test.ts`, `decide.test.ts`, `agents.test.ts`, `routing.test.ts`, `approvals-copy.test.ts` and `crew-projection.test.ts`.
  - Fake-agent provider: `test/acp-codex-do.test.ts`, which simulates Codex's options and `cancel`.
  - DB: `test/codex-crew.db.test.ts`, plus the updated `approvals.db.test.ts` and `chat-settings.db.test.ts`.
  - Browser: `approvals.spec.ts` (a Codex command card shows the sandbox note) and `permission-modes.spec.ts` (Codex's modes in the picker).

### Live check (September 26)

`test/codex-do.live.test.ts` ran in scratch repos under the session scratchpad on the ChatGPT login, with `gpt-6-luna` · low and no Jev. Task: `ls`, `cat README.md`, append a line, `git status --short`. Every Codex tool call had an approval row with the same tool-call id. The rows use the level names of the time; `0049_levels_full_auto_ship.sql` and `0050_provider_modes.sql` map Hands-on and Balanced to Ask every time with Review each step, and Hands-off and Full auto to Approve for me with Automatic and Full auto → PR.

| Level     | Where    | Receipts                                                                               | Tokens |
| --------- | -------- | -------------------------------------------------------------------------------------- | ------ |
| Hands-on  | in place | `ls`, `cat`, the edit and `git status`: all decided by the user                        | 17.2K  |
| Balanced  | in place | `ls`, `cat` and `git status` allowed as safe reads; the shell edit decided by the user | 17.2K  |
| Hands-off | worktree | all 4 allowed by the level, in Bolt's copy, then merged                                | 17.3K  |
| Full auto | worktree | all 4 allowed by the level, in Bolt's copy, then merged                                | 17.6K  |

Codex usage for Phase A and B together was about $0.03 API-equivalent, against the $0.50 cap.

### Still open

- Codex's sandbox can read any file. Indirect secret reads by searches and scripts aren't visible to us.
- An escalated command leaves the sandbox after one approval, and the request doesn't show it.
- Safe reads are judged lexically. A symlink inside the project that points outside is not resolved, which applies to Claude's Bash too.
- `npx`, `pnpm dlx` and similar download-and-run commands aren't treated as installs.
- The audit view doesn't label a same-provider Critic yet.
