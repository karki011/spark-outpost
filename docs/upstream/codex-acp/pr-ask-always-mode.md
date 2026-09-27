<!-- DRAFT for the user to review and submit from their own account. Not opened. Open only after the maintainers answer the issue (issue-ask-always-mode.md). Branch from agentclientprotocol/codex-acp main in your own fork. -->

**Title:** `feat: add an ask-always mode that asks before every command and file edit`

(A conventional-commit title is required by `conventional-prs.yml`. `feat:` releases a minor version.)

## Summary

Adds a fifth access preset, **Ask every time** (`ask-always`). It keeps the `workspace-write` sandbox, but sends `approvalPolicy: "untrusted"` with the user as reviewer. Every command and every file change then reaches `session/request_permission`, including reads such as `ls` or `cat .env`, which every other mode runs unasked.

Closes #<issue number>.

## Why

Clients that mediate every agent action through their own policy (audit trails, allow lists, secret-file rules) need a mode in which nothing runs unasked. #480 made the presets honest about what they allow. This adds the strict end of the range without changing the existing four modes or the default.

`untrusted` is the app-server's `AskForApproval` value for Codex's untrusted-project policy ("Commands require approval unless an explicit exec policy rule allows them"). Codex retired it as a config.toml or CLI setting in 0.149 (openai/codex#39630), but it is still part of the app-server v2 protocol in 0.157.0, and `turn/start` accepts it.

## The change

`src/AgentMode.ts`:

```ts
    static readonly AskAlways = new AgentMode(
        "ask-always",
        "Ask every time",
        "Ask before every command and file edit, including reads. Commands run in the workspace sandbox without network.",
        "standard",
        "untrusted",
        "user",
        {
            type: "workspaceWrite",
            writableRoots: [],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
        },
        "workspace-write",
    );
```

```ts
    static all(): AgentMode[] {
        return [
            AgentMode.ReadOnly,
            AgentMode.AskAlways,
            AgentMode.WorkspaceWrite,
            AgentMode.Agent,
            AgentMode.AgentFullAccess,
        ];
    }
```

- The sandbox is identical to `WorkspaceWrite`, so the two presets differ only in when Codex asks. Additional session roots are widened as for `workspace-write` (`addAdditionalDirectoriesToSandboxPolicy`).
- `README.md` and `readme-dev.md`: `INITIAL_AGENT_MODE` lists `read-only`, `ask-always`, `workspace-write`, `agent` or `agent-full-access`.
- No change to `DEFAULT_AGENT_MODE`, `CodexAcpClient.sendPrompt` (it already sends the mode's policy on every `turn/start`) or `/status`, which prints `Approval: untrusted`.

## Tests

- `src/__tests__/CodexACPAgent/session-config-options.test.ts`:
  - Add `ask-always` to the expected `mode` config options and to `availableModes`.
  - Add rows to the `applies $modeId permissions after $selection from $initialMode` matrix:

    ```ts
    {selection: "INITIAL_AGENT_MODE", initialMode: "ask-always", modeId: "ask-always"},
    {selection: "session/set_mode", initialMode: "agent", modeId: "ask-always"},
    {selection: "session/set_config_option", initialMode: "agent-full-access", modeId: "ask-always"},
    {selection: "session/set_config_option", initialMode: "ask-always", modeId: "read-only"},
    ```

  - New snapshot `data/ask-always-mode-policy.json`:

    ```json
    [
      {
        "approvalPolicy": "untrusted",
        "approvalsReviewer": "user",
        "sandboxPolicy": {
          "type": "workspaceWrite",
          "writableRoots": ["/test/extra"],
          "networkAccess": false,
          "excludeTmpdirEnvVar": false,
          "excludeSlashTmp": false
        }
      }
    ]
    ```

- `src/__tests__/CodexACPAgent/e2e/acp-e2e-shell-approval.test.ts`, a new `describeE2E("E2E ask-always mode shell permission tests")` using `createAuthenticatedFixture(AgentMode.AskAlways)`:
  - "requests permission for a read-only workspace command": `ls` produces at least one `execute` request.
  - "does not write inside the workspace when shell permission is cancelled": the same shape as the read-only case.
- `acp-e2e-file-approval.test.ts`: "requests permission for an in-workspace apply_patch" under `AskAlways`, where `workspace-write` doesn't ask.

Validation to fill in before opening:

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build` and `npm run bundle:all`
- [ ] `npm run test:e2e` for the new cases, with the Codex version bundled on `main`
- [ ] Manual probe on the PR build: `ls`, `cat .env` and an in-workspace `apply_patch` each ask; after `allow_once`, `echo hi > shell.txt` writes the file. (Results on 1.13.1/Codex 0.156.1 are in the issue; reconfirmed September 27, 2026 with the patch hand-applied to 1.13.2-preview.5/Codex 0.157.1 — still rerun this checklist item against the actual PR branch build, not just the hand-applied patch, before opening.)

## Compatibility

- Additive: a new mode id. Clients that list modes from `availableModes` or the `mode` config option show it automatically. Clients that hard-code the four ids are unaffected.
- **Codex dependency:** this relies on the app-server continuing to accept `approvalPolicy: "untrusted"` on `turn/start`. If a later Codex removes it, `turn/start` would fail in this mode only, and the unit snapshot plus the e2e `ls` case will catch it on the next `codex-update` PR. If you'd rather not depend on it, the issue discusses the alternative (not marking session roots trusted).
- Known limitation, described in the issue: an approved command that Codex runs with escalated permissions leaves the sandbox, and the approval request doesn't show whether a command is escalated. This is Codex behavior and the same in every mode.
