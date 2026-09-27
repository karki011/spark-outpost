<!-- FINAL DRAFT for the user to review and submit from their own account. Not filed. Target: https://github.com/agentclientprotocol/codex-acp/issues/new. File after the ask-always issue; POSTING_PLAN.md replaces #<ask-always issue>. Only the text between the BODY markers is posted. The openai/codex variant at the end is optional and separate. -->

**Title:** Rejecting a command or file edit can only end the turn when Codex doesn't offer `decline`

<!-- BODY BELOW -->

### Summary

A client that rejects one action often wants the agent to carry on without it ("skip this, keep going"), which is what Codex's own `decline` decision does. codex-acp only offers that option when Codex puts `decline` in `availableDecisions`. In several common cases it doesn't:

- **File changes:** `fileChangeDecisionOptions()` always returns allow once, allow for these files and **cancel**. `docs/permission-extension.md` notes that `FileChangeApprovalDecision` includes `decline`, but "the native Codex file-change prompt does not currently advertise it".
- **Escalation requests in `read-only`:** when the model asks to run a write command outside the sandbox, Codex sends `availableDecisions` of `["accept", {acceptWithExecpolicyAmendment}, "cancel"]`.
- **Commands under `approvalPolicy: "untrusted"`** (see #<ask-always issue>): the same three decisions, for every command.

In all of these, the only `reject_once` option is `cancel`. Selecting it interrupts the turn, and `session/prompt` returns `stopReason: "cancelled"` although the client never sent `session/cancel`.

I understand from #405 and `docs/permission-extension.md` that the adapter deliberately "does not invent replacement choices", and from #26 that interrupting after a rejected file edit is intended for clients where the user then types what to do differently. So the proposal below keeps that contract by default and makes the extra option opt-in.

### Reproduction

A raw ACP client over stdio, a fresh git repo as `cwd`, fresh session per action, `gpt-6-luna` at low effort.

| codex-acp / Codex                        | Mode                           | Client opted in | Action                             | Options offered                                                  | Answer    | Written? | `stopReason` |
| ---------------------------------------- | ------------------------------ | --------------- | ---------------------------------- | ---------------------------------------------------------------- | --------- | -------- | ------------ |
| 1.13.1 / 0.156.1                         | `untrusted` forced onto a mode | –               | `echo hi > shell.txt`              | `allow_once`, `accept_execpolicy_amendment`, `cancel`            | `cancel`  | no       | `cancelled`  |
| 1.13.1 / 0.156.1                         | `untrusted` forced onto a mode | –               | `apply_patch`                      | `allow_once`, `allow_for_session`, `cancel`                      | `cancel`  | no       | `cancelled`  |
| 1.13.2-preview.5 / 0.157.1               | `untrusted` forced onto a mode | –               | `echo hi > shell.txt`              | `allow_once`, `accept_execpolicy_amendment`, `cancel`            | `cancel`  | no       | `cancelled`  |
| `main` + proposed change / 0.157.0       | `read-only`                    | no              | `apply_patch`                      | `allow_once`, `allow_for_session`, `cancel`                      | `cancel`  | no       | `cancelled`  |
| `main` + proposed change / 0.157.0       | `read-only`                    | yes             | `apply_patch`                      | `allow_once`, `allow_for_session`, `decline`, `cancel`           | `decline` | no       | `end_turn`   |
| `main` + proposed change / 0.157.0       | `read-only`                    | yes             | `echo hi > shell.txt` (escalation) | `allow_once`, `accept_execpolicy_amendment`, `decline`, `cancel` | `decline` | no       | `end_turn`   |
| `main` + both proposed changes / 0.157.0 | `ask-always`                   | yes             | `echo hi > shell.txt`              | `allow_once`, `accept_execpolicy_amendment`, `decline`, `cancel` | `decline` | no       | `end_turn`   |
| `main` + both proposed changes / 0.157.0 | `ask-always`                   | yes             | `apply_patch`                      | `allow_once`, `allow_for_session`, `decline`, `cancel`           | `decline` | no       | `end_turn`   |
| `main` + both proposed changes / 0.157.0 | `ask-always`                   | yes             | `echo hi > shell.txt`              | `allow_once`, `accept_execpolicy_amendment`, `decline`, `cancel` | `cancel`  | no       | `cancelled`  |

After `decline`, the model replied that the action was rejected and finished the turn normally, so the app-server accepts `decline` for both request types even when it doesn't advertise it. The same held on 1.13.1 / 0.156.1 and 1.13.2-preview.5 / 0.157.1, with `decline` added by a local adapter change. Nothing here changed between Codex 0.156.1 and 0.157.1.

Our client, Spark Outpost, found this while routing every Codex action through its own approval step: a user's "no" to one command ended the whole run.

### Expected

A way to get a `reject_once` option that rejects the single action and lets the turn continue, as `decline` already does whenever Codex advertises it (`"No, continue without running it"`).

A smaller, related point: ACP defines `stopReason: "cancelled"` as "The turn was cancelled by the client via `session/cancel`". Returning it after a permission rejection, with no `session/cancel`, makes it hard for clients to tell "the user stopped the run" from "the user rejected one action".

### Proposal

An opt-in client capability. A client that sets `clientCapabilities._meta.continueOnReject: true` on `initialize` gets Codex's `decline` right before `cancel`:

- in command and network approvals whose decision set has `cancel` but no `decline` (labelled `No, continue without running it`);
- in every file-change approval (labelled `No, continue without making these edits`).

`decline` is never added twice, never to a decision set without `cancel`, and never to the legacy additional-permissions fallback. `cancel`, and an ACP `cancelled` outcome, still map to `cancel`. Without the capability nothing changes, so #405's contract and #26's interrupt flow stay the default. A draft PR implementing this, with tests, references this issue.

Alternatives we considered:

- **Always offer `decline` before `cancel`** (no capability). Smallest change, but it changes behaviour for clients that answer with "the first `reject_once` option", and departs from "authoritative `availableDecisions`" for everyone.
- **Fix it in Codex:** the app-server advertises `decline` in `availableDecisions` for `untrusted` and escalation requests, and adds `availableDecisions` to file-change requests. Then codex-acp needs no change for commands, because it already maps `decline`. We can file this in openai/codex if you'd rather go that way.

Would you accept the opt-in, or prefer one of the alternatives?
<!-- END BODY -->

---

<!-- OPTIONAL SEPARATE DRAFT (the "fix it in Codex" alternative), for https://github.com/openai/codex/issues/new. File only if the codex-acp maintainers point there, or in parallel with a link to the codex-acp issue. Not in POSTING_PLAN.md. -->

**Title (openai/codex):** app-server: `availableDecisions` for command approvals under `untrusted` and for escalation requests omits `decline`

When a turn runs with `approvalPolicy: "untrusted"` (the untrusted-project policy), or when the model requests escalation for a command under a read-only sandbox, `item/commandExecution/requestApproval` sends `availableDecisions: ["accept", {"acceptWithExecpolicyAmendment": …}, "cancel"]`. So a client's only way to reject is `cancel`, which interrupts the turn. `CommandExecutionApprovalDecision` includes `decline`, and the app-server honours it in this situation: when we returned `decline` anyway, the command didn't run and the turn continued with the model acknowledging the rejection. `item/fileChange/requestApproval` has no `availableDecisions` at all, although `FileChangeApprovalDecision` also includes `decline`.

Seen with `@openai/codex` 0.156.1, 0.157.0 and 0.157.1 through codex-acp (ACP adapter).

Request:

- Include `decline` before `cancel` in `availableDecisions` for these command approvals. codex-acp's fallback for Codex versions that send no `availableDecisions`, which mirrors the native set, already offers `decline` before `cancel`.
- Consider adding `availableDecisions` to file-change approval requests.

Context: agentclientprotocol/codex-acp#<decline issue>.
