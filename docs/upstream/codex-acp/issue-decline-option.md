<!-- DRAFT for the user to review and submit from their own account. Not filed. Target: https://github.com/agentclientprotocol/codex-acp/issues/new. It works best filed after the ask-always issue, and linked to it. -->

**Title:** Rejecting a command or file edit always ends the turn: no continue-on-reject option under `untrusted` or for file changes

### Summary

A client that rejects one action often wants the agent to carry on without it ("skip this, keep going"), which is how Codex's own `decline` decision behaves. codex-acp only offers that option when Codex puts `decline` in `availableDecisions`. In two common cases it doesn't:

- **File changes:** `fileChangeDecisionOptions()` always returns allow once, allow for these files and **cancel**. `docs/permission-extension.md` notes that `FileChangeApprovalDecision` includes `decline`, but "the native Codex file-change prompt does not currently advertise it".
- **Commands under `approvalPolicy: "untrusted"`:** Codex sends `availableDecisions` of `["accept", {acceptWithExecpolicyAmendment}, "cancel"]`, without `decline`.

In both cases, the only `reject_once` option is `cancel`. Selecting it interrupts the turn, and `session/prompt` returns `stopReason: "cancelled"` even though the client never sent `session/cancel`.

I understand from #405 and `docs/permission-extension.md` that the adapter deliberately "does not invent replacement choices", and from #26 that interrupting after a rejected file edit is intended for clients where the user then types what to do differently. So this issue is a question about which fix you'd accept, not a PR.

### Reproduction

codex-acp 1.13.1, `@openai/codex` 0.156.1, a raw ACP client, a fresh git repo as `cwd`. The session uses a mode with `approvalPolicy: "untrusted"` and a `workspaceWrite` sandbox (see #<ask-always issue>). The `read-only` mode shows the same thing for writes.

1. Prompt: "Run exactly this shell command and nothing else: `echo hi > shell.txt`".
2. `session/request_permission` offers `allow_once` ("Yes, proceed"), `accept_execpolicy_amendment` and `cancel` ("No, and tell Codex what to do differently", `reject_once`).
3. Answer `cancel`.

Actual: `shell.txt` isn't written (good). But the turn ends with `stopReason: "cancelled"`, and the model never gets to react. We saw the same for `ls` and for `apply_patch`, where the options were `allow_once`, `allow_for_session` and `cancel`.

With the adapter changed to also offer Codex's `decline` (see option A below) and the client answering `decline`: `shell.txt` and `notes.txt` stayed unwritten, and the turn ended normally with `end_turn`. The model replied that the command was rejected and continued. So the app-server accepts `decline` for both request types under `untrusted`.

### Expected

At least one `reject_once` option that rejects the single action and lets the turn continue, as `decline` already does whenever Codex advertises it (`"No, continue without running it"`).

A smaller, related point: ACP defines `stopReason: "cancelled"` as "The turn was cancelled by the client via `session/cancel`". Returning it after a permission rejection, with no `session/cancel`, makes it hard for clients to tell "the user stopped the run" from "the user rejected one action".

### Options

- **A. The adapter offers `decline` ahead of `cancel`** when Codex's decision set contains `cancel` but not `decline`, and always for file changes. It's small, and it needs no Codex change. It departs from "authoritative `availableDecisions`" for this one choice, which is a documented Codex decision the app-server accepts.
- **B. Like A, but opt-in:** only when the client asks for it (for example `_meta.codex.continueOnReject: true` on `session/new`), or only in the ask-always mode proposed in #<ask-always issue>. The existing contract stays unchanged for everyone else.
- **C. Fix it in Codex:** the app-server advertises `decline` in `availableDecisions` under `untrusted`, and in a future file-change `availableDecisions`. Then codex-acp needs no change for commands, because it already maps `decline`. We can file this in openai/codex if that's where you'd want it.

Which one would you accept? For A or B we can send a PR with tests right away.

---

<!-- SEPARATE DRAFT (option C), for https://github.com/openai/codex/issues/new. File only if the codex-acp maintainers point there, or in parallel with a link to the codex-acp issue. -->

**Title (openai/codex):** app-server: `availableDecisions` for command approvals under `untrusted` omits `decline`

When a turn runs with `approvalPolicy: "untrusted"` (the untrusted-project policy), `item/commandExecution/requestApproval` sends `availableDecisions: ["accept", {"acceptWithExecpolicyAmendment": …}, "cancel"]`. So a client's only way to reject is `cancel`, which interrupts the turn. `CommandExecutionApprovalDecision` includes `decline`, and the app-server honours it in this situation: when we returned `decline` anyway, the command didn't run and the turn continued with the model acknowledging the rejection. `item/fileChange/requestApproval` has no `availableDecisions` at all, although `FileChangeApprovalDecision` also includes `decline`.

Seen with `@openai/codex` 0.156.1 through codex-acp 1.13.1 (ACP adapter).

Request:

- Include `decline` before `cancel` in `availableDecisions` for untrusted-policy command approvals. codex-acp's fallback for Codex versions that send no `availableDecisions`, which mirrors the native set, already offers `decline` before `cancel`.
- Consider adding `availableDecisions` to file-change approval requests.

Context: agentclientprotocol/codex-acp#<decline issue>.
