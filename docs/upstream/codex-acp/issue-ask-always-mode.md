<!-- DRAFT for the user to review and submit from their own account. Not filed. Target: https://github.com/agentclientprotocol/codex-acp/issues/new -->

**Title:** No mode asks before every command and file edit (an `untrusted`-style preset)

### Summary

All four modes on `main` (`read-only`, `workspace-write`, `agent` and `agent-full-access`) send `approvalPolicy: "on-request"` or `"never"` on `turn/start`. Under `on-request`, Codex runs every command it judges to fit the sandbox without a `session/request_permission`. That includes plain reads such as `ls`, `cat .env` and `cat ../outside/.env`, and, in `workspace-write`, in-workspace edits and deletes. Some ACP clients mediate every action through their own policy engine (per-action audit, allow lists, secret-file rules), as the orchestrator in #450 and our client, Spark Outpost, do. For them, no mode makes every action reach `session/request_permission`.

The app-server still accepts `approvalPolicy: "untrusted"` per turn. Codex's own protocol source documents it as the "internal policy for projects marked untrusted. Commands require approval unless an explicit exec policy rule allows them". With that policy, every command and every `apply_patch` reached the client in our tests, and nothing ran unasked.

Since #480 already turned the modes into clear access presets, one more preset would cover this. We'd like to know whether you'd accept one before we send the PR.

### Reproduction

Environment: codex-acp 1.13.1 with the bundled `@openai/codex` 0.156.1, macOS (Seatbelt). A raw ACP client over stdio:

1. `initialize` (fs read/write client capabilities).
2. `session/new {cwd: <fresh git repo with a .env>, mcpServers: []}`.
3. Set the mode with `session/set_config_option`.
4. Send one `session/prompt`: "Run exactly this shell command and nothing else: …", or "Use your apply_patch tool to create …".

Every `session/request_permission` was logged, and each request was answered `allow_once`. We used a fresh session per action. The `workspaceWrite` rows used `networkAccess: false` and `excludeSlashTmp: true`.

| Action                         | `workspaceWrite` + `on-request` (≈ `workspace-write`) | `workspaceWrite` + `untrusted` |
| ------------------------------ | ----------------------------------------------------- | ------------------------------ |
| `ls`, `pwd`                    | ran, no request                                       | request                        |
| `cat README.md`                | ran, no request                                       | request                        |
| `git status --short`           | ran, no request                                       | request                        |
| `cat .env` (in the workspace)  | ran, no request                                       | request                        |
| `cat ../outside/.env`          | ran, no request                                       | request                        |
| `apply_patch` in the workspace | file written, no request                              | request                        |
| `echo hi > shell.txt`          | file written, no request                              | request                        |
| `rm README.md`                 | deleted, no request                                   | request                        |
| `apply_patch` outside          | request                                               | request                        |
| `echo x > ../outside/…`        | request                                               | request                        |

`read-only` (after #480) asks for writes, but still runs every read unasked, including both `.env` reads.

Workarounds that don't work:

- `CODEX_CONFIG={"approval_policy":"untrusted"}` fails the session with "no longer supported" (see the comment in #450, and openai/codex#39630).
- Config-level settings are overridden by the per-turn policy anyway (#310).
- Exec-policy `prompt` rules in `<repo>/.codex/rules/` do work, but only for the programs listed, and they need a file in the user's repository.

### Expected

A mode a client can select with `session/set_mode` or `session/set_config_option` in which every command and every file change produces a `session/request_permission`.

### Proposal

Add a fifth preset, for example:

| id           | name           | approval policy | reviewer | sandbox                                                  |
| ------------ | -------------- | --------------- | -------- | -------------------------------------------------------- |
| `ask-always` | Ask every time | `untrusted`     | `user`   | same as `workspace-write` (`workspaceWrite`, no network) |

- It isn't the default, and it doesn't change the other modes.
- It can be selected through `INITIAL_AGENT_MODE`, `session/set_mode` and `session/set_config_option`. It's listed in `README.md` and `readme-dev.md`.
- Tests: the same `session-config-options` matrix as #480 (policy snapshot after each selection path), plus an e2e case that `ls` requests permission.

Open questions for you:

1. **Wire value.** Codex retired `untrusted` from the CLI and config.toml in 0.149 (openai/codex#39630; pushback in openai/codex#39973), but kept it in the app-server `AskForApproval` enum as the untrusted-project policy. Are you comfortable with a preset that sends it? The alternative is Codex's supported route: don't mark the session roots `trust_level: "trusted"` in `createSessionConfig`, so Codex applies its own untrusted-project policy. But that is fixed at thread start rather than per mode, and it also changes which project config Codex loads. We haven't probed it.
2. **Naming.** Would you prefer another id or name, or a sandbox other than `workspace-write`'s? With `readOnly`, an approved write needs escalation.

We have a patch and tests ready, and can open the PR if the direction works for you.

### Notes from the same probe (for context, not part of this request)

- An approved command may leave the sandbox if the model asked for escalation. One approval then allowed a write outside the workspace and network access. The request doesn't show whether a command is escalated: `rawInput` has only `command` and `cwd`, and `_meta.permission` has no description under `untrusted`. Clients should treat every allowed command as trusted.
- Denying with the only reject option under `untrusted` (`cancel`) ends the turn. That's a separate issue: [link to the decline-option issue once filed].
