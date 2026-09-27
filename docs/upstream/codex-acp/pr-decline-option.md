<!-- FINAL DRAFT for the user to review. Not opened. Branch `feat/decline-option` (one commit on agentclientprotocol/codex-acp main bf37821); full diff in feat-decline-option.patch. Implements the opt-in variant ("option B") from issue-decline-option.md. Open as a DRAFT PR after both issues exist; POSTING_PLAN.md fills in the issue numbers and posts only the text between the BODY markers. -->

**Title:** `feat: offer decline before cancel for clients that opt in`

<!-- BODY BELOW -->

Closes #<decline issue>

## Summary

Adds an opt-in client capability, `clientCapabilities._meta.continueOnReject`. A client that sets it on `initialize` gets Codex's `decline` decision ("No, continue without …", `reject_once`) right before `cancel` whenever Codex's decision set offers `cancel` but not `decline`, and in every file-change approval. A rejected action is then skipped and the turn continues. Without the capability, permission requests are byte-for-byte unchanged.

## Motivation

Codex doesn't advertise `decline` for file changes, for escalation requests in `read-only`, or for any command under `approvalPolicy: "untrusted"` (#<ask-always issue>). There the only `reject_once` option is `cancel`, which interrupts the turn and ends `session/prompt` with `stopReason: "cancelled"`, although the client never sent `session/cancel`. The app-server accepts `decline` in all of these cases; it just isn't offered.

#405 made `availableDecisions` authoritative ("the adapter does not invent replacement choices"), and #26 relies on `cancel` interrupting the turn after a rejected file edit. Making the extra option opt-in keeps both as the default and lets clients that want "skip this, keep going" ask for it.

Evidence from a raw ACP client (fresh session per action):

| Build / Codex                        | Mode         | Opted in | Action                             | Options offered                                                  | Answer    | Written? | `stopReason` |
| ------------------------------------ | ------------ | -------- | ---------------------------------- | ---------------------------------------------------------------- | --------- | -------- | ------------ |
| 1.13.1 / 0.156.1                     | `untrusted`  | –        | `echo hi > shell.txt`              | `allow_once`, `accept_execpolicy_amendment`, `cancel`            | `cancel`  | no       | `cancelled`  |
| 1.13.2-preview.5 / 0.157.1           | `untrusted`  | –        | `echo hi > shell.txt`              | `allow_once`, `accept_execpolicy_amendment`, `cancel`            | `cancel`  | no       | `cancelled`  |
| this branch / 0.157.0                | `read-only`  | no       | `apply_patch`                      | `allow_once`, `allow_for_session`, `cancel`                      | `cancel`  | no       | `cancelled`  |
| this branch / 0.157.0                | `read-only`  | yes      | `apply_patch`                      | `allow_once`, `allow_for_session`, `decline`, `cancel`           | `decline` | no       | `end_turn`   |
| this branch / 0.157.0                | `read-only`  | yes      | `echo hi > shell.txt` (escalation) | `allow_once`, `accept_execpolicy_amendment`, `decline`, `cancel` | `decline` | no       | `end_turn`   |
| this branch + `ask-always` / 0.157.0 | `ask-always` | yes      | `echo hi > shell.txt`              | `allow_once`, `accept_execpolicy_amendment`, `decline`, `cancel` | `decline` | no       | `end_turn`   |
| this branch + `ask-always` / 0.157.0 | `ask-always` | yes      | `apply_patch`                      | `allow_once`, `allow_for_session`, `decline`, `cancel`           | `decline` | no       | `end_turn`   |
| this branch + `ask-always` / 0.157.0 | `ask-always` | yes      | `echo hi > shell.txt`              | `allow_once`, `accept_execpolicy_amendment`, `decline`, `cancel` | `cancel`  | no       | `cancelled`  |

After `decline`, the model said the action was rejected and finished normally. `cancel` keeps interrupting the turn.

## The change

- `src/permissions/capabilities.ts` (new): `clientSupportsContinueOnReject(clientCapabilities)` reads `clientCapabilities._meta.continueOnReject === true`, in the same style as the `terminal_output_delta` capability.
- `src/permissions/options.ts`:
  - `commandDecisionOptions(params, continueOnReject = false)`: with the flag, `withDeclineBeforeCancel` inserts `decline` right before `cancel` when the parsed decision set has `cancel` and no `decline`. It is not applied to the legacy additional-permissions fallback, which keeps accept and cancel only. The existing ordering and completeness checks run unchanged afterwards.
  - `fileChangeDecisionOptions(continueOnReject = false)`: with the flag, adds `No, continue without making these edits` (`decline`) before `cancel`.
- `src/permissions/CodexApprovalHandler.ts`: takes the flag as an optional constructor argument (default `false`) and passes it to both helpers. `src/CodexAcpServer.ts` passes `clientSupportsContinueOnReject(this.clientCapabilities)`.
- `docs/permission-extension.md`: a new "Continue-on-reject capability" section (marked experimental), with cross-references from "Command and network decisions" and "File changes". "Does not invent replacement choices" stays true for everyone who doesn't opt in.

## Tests

`approval-events.test.ts`, with the capability set on `initialize`:

- offers `decline` before `cancel` when Codex's decision set lacks it, using the exact `untrusted` shape (`accept`, exec-policy amendment, `cancel`); selecting it returns `{decision: "decline"}`. The full permission request is pinned in `data/approval-command-continue-on-reject.json`.
- an explicit `cancel` selection still returns `cancel`, and an ACP `cancelled` outcome still returns `cancel`, not `decline`.
- keeps a single `decline` when Codex already advertises it; adds nothing to a decision set without `cancel`; adds nothing to the legacy additional-permissions fallback.
- after a declined command, the prompt ends with `end_turn` once Codex completes the turn, and the adapter never calls `turn/interrupt`.
- file changes: offers `decline` before `cancel` and maps it to `decline` (prompt ends with `end_turn`); `cancel` and ACP cancellation still return `cancel`.

Without the capability: a new test pins the native file-change options (`allow_once`, `allow_for_session`, `cancel`), and every existing test, including "supports the native accept-plus-cancel decision set without inventing decline", passes unchanged.

E2E (`RUN_E2E_TESTS=true`, `read-only` mode with the capability): `createAuthenticatedFixture` gains an optional `clientCapabilitiesMeta` argument. New cases check that declining an in-workspace file edit, and declining an in-workspace write command, both end with `end_turn` and leave the file unwritten.

Local results:

- [x] `npm run typecheck`
- [x] `CI=true npm test`: 60 files passed, 789 tests passed, 34 skipped (the e2e suites)
- [x] `npm run build`
- [ ] `npm run bundle:all`: not run locally (no bun installed); the change adds no dependencies or build inputs
- [ ] `npm run test:e2e`: not run (needs an OpenAI API key); the manual probe above covers the same cases

## Compatibility

- No behavior change unless a client sets `continueOnReject: true`. Existing clients, including ones that answer with "the first `reject_once` option", see exactly today's options.
- For clients that opt in, `decline` comes before `cancel`, so a client that answers with the first `reject_once` option gets "continue without it". Clients that choose by `optionId` can offer both.
- Relies on the app-server accepting `decline` for command and file-change approvals even when it doesn't advertise it. Both decisions are part of the generated v2 types (`CommandExecutionApprovalDecision`, `FileChangeApprovalDecision`) and were verified live on Codex 0.156.1, 0.157.0 and 0.157.1.
- If Codex later advertises `decline` itself, the capability becomes a no-op for those prompts (no duplicate is added).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
<!-- END BODY -->
