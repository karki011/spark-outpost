<!-- FINAL DRAFT for the user to review and submit from their own account. Not filed. Target: https://github.com/agentclientprotocol/codex-acp/issues/new. File this one first; the decline issue and both PRs link to it. POSTING_PLAN.md posts only the text between the BODY markers. -->

**Title:** No mode asks before every command and file edit (an `untrusted`-style preset)

<!-- BODY BELOW -->

### Summary

All four modes on `main` (`read-only`, `workspace-write`, `agent` and `agent-full-access`) send `approvalPolicy: "on-request"` or `"never"` on `turn/start`. Under `on-request`, Codex runs every command it judges to fit the sandbox without a `session/request_permission`. That includes plain reads such as `ls`, `cat .env` and `cat ../outside/.env`, and, in `workspace-write`, in-workspace edits and deletes. Some ACP clients mediate every action through their own policy engine (per-action audit, allow lists, secret-file rules), as the orchestrator in #450 and our client, Spark Outpost, do. For them, no mode makes every action reach `session/request_permission`.

The app-server still accepts `approvalPolicy: "untrusted"` per turn. Codex's own protocol source documents it as the "internal policy for projects marked untrusted. Commands require approval unless an explicit exec policy rule allows them". With that policy, every command and every `apply_patch` reached the client in our tests, and nothing ran unasked.

Since #480 already turned the modes into clear access presets, one more preset would cover this. We've opened a draft PR with tests that references this issue, and we'd like to know whether the direction works for you before marking it ready.

### Reproduction

A raw ACP client over stdio, macOS (Seatbelt):

1. `initialize` (fs read/write client capabilities).
2. `session/new {cwd: <fresh git repo with a .env>, mcpServers: []}`.
3. Set the mode with `session/set_config_option`.
4. Send one `session/prompt`: "Run exactly this shell command and nothing else: …", or "Use your apply_patch tool to create …".

Every `session/request_permission` was logged and answered `allow_once`, with a fresh session per action.

**codex-acp 1.13.1, `@openai/codex` 0.156.1** (the `workspaceWrite` rows used `networkAccess: false`; `untrusted` was forced onto the mode):

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

**codex-acp 1.13.2-preview.5, `@openai/codex` 0.157.1:** the same result. Forcing `untrusted` onto the native `workspace-write` mode made `ls`, `cat .env` and `apply_patch` each request permission, and nothing ran unasked.

**`main` (`bf37821`) plus the proposed preset, `@openai/codex` 0.157.0** (the version `main` bundles):

| Action                         | `workspace-write`               | proposed `ask-always`               |
| ------------------------------ | ------------------------------- | ----------------------------------- |
| `ls`                           | ran, no request                 | request                             |
| `cat README.md`                | not rerun                       | request                             |
| `cat .env`                     | ran, no request, secret printed | request                             |
| `apply_patch` in the workspace | file written, no request        | request; written after `allow_once` |
| `echo hi > shell.txt`          | not rerun                       | request; written after `allow_once` |

Workarounds that don't work:

- `CODEX_CONFIG={"approval_policy":"untrusted"}` fails the session with "no longer supported" (see the comment in #450, and openai/codex#39630).
- Config-level settings are overridden by the per-turn policy anyway (#310).
- Exec-policy `prompt` rules in `<repo>/.codex/rules/` do work, but only for the programs listed, and they need a file in the user's repository.

### Expected

A mode a client can select with `session/set_mode` or `session/set_config_option` in which every command and every file change produces a `session/request_permission`.

### Proposal

Add a fifth preset:

| id           | name           | approval policy | reviewer | sandbox                                                  |
| ------------ | -------------- | --------------- | -------- | -------------------------------------------------------- |
| `ask-always` | Ask every time | `untrusted`     | `user`   | same as `workspace-write` (`workspaceWrite`, no network) |

- It isn't the default, and it doesn't change the other modes.
- It can be selected through `INITIAL_AGENT_MODE`, `session/set_mode` and `session/set_config_option`, and is listed in `README.md` and `readme-dev.md`.
- Tests: the `session-config-options` policy matrix from #480, plus e2e cases.

Open questions:

1. **Wire value.** Codex retired `untrusted` from the CLI and config.toml in 0.149 (openai/codex#39630; pushback in openai/codex#39973), but kept it in the app-server `AskForApproval` enum as the untrusted-project policy, and it still works per turn on 0.157. Are you comfortable with a preset that sends it? The alternative is Codex's supported route: don't mark the session roots `trust_level: "trusted"` in `createSessionConfig`, so Codex applies its own untrusted-project policy. But that is fixed at thread start rather than per mode, and it also changes which project config Codex loads. We haven't probed it.
2. **Naming and placement.** Would you prefer another id or name, a different position in the mode list (the PR appends it at the end, so existing mode positions don't change), or a sandbox other than `workspace-write`'s? With `readOnly`, an approved write needs escalation.

### Notes from the same probes (context, not part of this request)

- An approved command may leave the sandbox if the model asked for escalation. One approval then allowed a write outside the workspace and network access. The request doesn't show whether a command is escalated: `rawInput` has only `command` and `cwd`, and `_meta.permission` has no description under `untrusted`. Clients should treat every allowed command as trusted.
- Under `untrusted`, the only reject option Codex offers is `cancel`, which ends the turn (`stopReason: "cancelled"`). That's covered in a separate issue, which links back here.

<!-- END BODY -->
