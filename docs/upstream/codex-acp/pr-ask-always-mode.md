<!-- FINAL DRAFT for the user to review. Not opened. Branch `feat/ask-always-mode` (one commit on agentclientprotocol/codex-acp main bf37821); full diff in feat-ask-always-mode.patch. Open as a DRAFT PR after both issues exist; POSTING_PLAN.md fills in the issue numbers and posts only the text between the BODY markers. -->

**Title:** `feat: add ask-every-time session mode`

<!-- BODY BELOW -->

Closes #<ask-always issue>

## Summary

Adds a fifth access preset, **Ask every time** (`ask-always`). It uses the same sandbox as `workspace-write` (workspace writable, no network), but sends `approvalPolicy: "untrusted"` with the user as reviewer. Every command and every file change then reaches `session/request_permission`, including reads such as `ls` or `cat .env`, which every other mode runs unasked.

## Motivation

Clients that mediate every agent action through their own policy (audit trails, allow lists, secret-file rules) need a mode in which nothing runs unasked. #480 made the presets honest about what they allow; this adds the strict end of the range without changing the existing four modes or the default.

`untrusted` is the app-server's `AskForApproval` value for Codex's untrusted-project policy ("Commands require approval unless an explicit exec policy rule allows them"). Codex retired it as a config.toml or CLI setting in 0.149 (openai/codex#39630), but it is still part of the app-server v2 protocol in 0.157, and `turn/start` accepts it.

Evidence from a raw ACP client (fresh session per action, requests answered `allow_once`):

| Action                         | 1.13.1 / Codex 0.156.1, `on-request` | 1.13.1 / Codex 0.156.1, `untrusted` | this branch / Codex 0.157.0, `workspace-write` | this branch / Codex 0.157.0, `ask-always` |
| ------------------------------ | ------------------------------------ | ----------------------------------- | ---------------------------------------------- | ----------------------------------------- |
| `ls`                           | ran, no request                      | request                             | ran, no request                                | request                                   |
| `cat README.md`                | ran, no request                      | request                             | not rerun                                      | request                                   |
| `cat .env`                     | ran, no request                      | request                             | ran, no request                                | request                                   |
| `apply_patch` in the workspace | written, no request                  | request                             | written, no request                            | request, written after `allow_once`       |
| `echo hi > shell.txt`          | written, no request                  | request                             | not rerun                                      | request, written after `allow_once`       |

The `untrusted` column was also reconfirmed on 1.13.2-preview.5 / Codex 0.157.1. The issue has the full table.

## The change

- `src/AgentMode.ts`: new `AgentMode.AskAlways` (`"ask-always"`, "Ask every time", kind `standard`, approval policy `untrusted`, reviewer `user`, a `workspaceWrite` sandbox identical to `WorkspaceWrite`, sandbox mode `workspace-write`). `AgentMode.all()` lists it last, after `AgentFullAccess`, so existing mode positions don't change.
- Additional session roots are widened as for `workspace-write`, through the existing `addAdditionalDirectoriesToSandboxPolicy`.
- `README.md` and `readme-dev.md`: `INITIAL_AGENT_MODE` lists `ask-always`.
- No change to `DEFAULT_AGENT_MODE`, to `CodexAcpClient.sendPrompt` (it already sends the mode's policies on every `turn/start`), or to `/status`, which prints `Approval: untrusted`.

## Tests

- `session-config-options.test.ts`: `ask-always` added to the expected `mode` config options and `availableModes`, and seven rows added to the `applies $modeId permissions after $selection from $initialMode` matrix (selection through `INITIAL_AGENT_MODE`, `session/set_mode` and `session/set_config_option`, into and out of `ask-always`). The new snapshot `data/ask-always-mode-policy.json` pins the outgoing `turn/start` policies: `untrusted`, `user`, and `workspaceWrite` with the extra root writable and no network.
- E2E (`RUN_E2E_TESTS=true`), new `ask-always` suites:
  - shell: a `cat` of a workspace file requests permission; an in-workspace write requests permission and is applied after `allow_once`; a cancelled request leaves the file unwritten.
  - file: an in-workspace edit requests permission and is applied after `allow_once`; a cancelled request leaves the file unwritten.

Local results:

- [x] `npm run typecheck`
- [x] `CI=true npm test`: 60 files passed, 786 tests passed, 37 skipped (the e2e suites)
- [x] `npm run build`
- [ ] `npm run bundle:all`: not run locally (no bun installed); the change adds no dependencies or build inputs
- [ ] `npm run test:e2e`: not run (needs an OpenAI API key); the manual probe above covers the same cases

## Compatibility

- Additive: a new mode id. Clients that list modes from `availableModes` or the `mode` config option show it automatically; clients that hard-code the four ids are unaffected. It is appended at the end of the list, so clients that pick modes by index are unaffected.
- **Codex dependency:** this relies on the app-server continuing to accept `approvalPolicy: "untrusted"` on `turn/start`. If a later Codex removes it, `turn/start` would fail in this mode only, and the snapshot plus the e2e cases would flag it on the next `codex-update` PR. The issue discusses the alternative (not marking session roots trusted).
- Known limitation (Codex behavior, the same in every mode): an approved command that Codex runs with escalated permissions leaves the sandbox, and the approval request doesn't say whether a command is escalated.
- Under `untrusted`, Codex offers `cancel` as the only reject option, so rejecting ends the turn. The PR for #<decline issue> adds an opt-in continue-on-reject option. The two PRs are independent and merge cleanly in either order.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
<!-- END BODY -->
