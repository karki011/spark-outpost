<!-- DRAFT for the user to review and submit from their own account. Not opened. CONDITIONAL: open only if the maintainers pick option A or B on the issue (issue-decline-option.md). If they pick C (a fix in openai/codex), this PR isn't needed. -->

**Title:** `feat: offer a continue-on-reject option for command and file-change approvals`

## Summary

When Codex's decision set has no `decline`, a client's only reject option is `cancel`, which interrupts the turn. This happens for every file change, and for commands under `approvalPolicy: "untrusted"`. This PR offers Codex's `decline` decision ("No, continue without …", `reject_once`) ahead of `cancel`. A rejected action is then skipped and the model carries on, and `cancel` keeps its current meaning.

Closes #<decline issue>.

## The change

`src/permissions/options.ts`:

```ts
export function commandDecisionOptions(
  params: CommandParamsWithAvailableDecisions,
): DecisionOption<CommandExecutionApprovalDecision>[] | undefined {
  const parsed = parseAvailableCommandDecisions(params);
  if (!parsed) return undefined;
  const decisions = params.additionalPermissions ? parsed : withContinueOnReject(parsed);
  // ... unchanged ...
}

/**
 * Codex accepts `decline` for command approvals, but does not advertise it under
 * the untrusted approval policy. Offer it before `cancel` so that a client can
 * reject one command without interrupting the turn.
 */
function withContinueOnReject(
  decisions: CommandExecutionApprovalDecision[],
): CommandExecutionApprovalDecision[] {
  if (decisions.includes('decline')) return decisions;
  const cancelIndex = decisions.indexOf('cancel');
  if (cancelIndex === -1) return decisions;
  return [...decisions.slice(0, cancelIndex), 'decline', ...decisions.slice(cancelIndex)];
}
```

```ts
export function fileChangeDecisionOptions(): DecisionOption<FileChangeApprovalDecision>[] {
  return [
    decisionOption(ApprovalOptionId.AllowOnce, 'Yes, proceed', 'allow_once', 'accept'),
    decisionOption(
      ApprovalOptionId.AllowForSession,
      "Yes, and don't ask again for these files",
      'allow_always',
      'acceptForSession',
    ),
    decisionOption(
      ApprovalOptionId.Decline,
      'No, continue without making these edits',
      'reject_once',
      'decline',
    ),
    decisionOption(
      ApprovalOptionId.Cancel,
      'No, and tell Codex what to do differently',
      'reject_once',
      'cancel',
    ),
  ];
}
```

- `decline` is inserted only when Codex offers `cancel`, never for additional-permission requests (those keep accept plus cancel), and never twice. `permissionOptionOrder` keeps it after the allow options and before `cancel`.
- Clients that pick the first `reject_once` option now get "continue without it". Clients that pick by `optionId` are unaffected. Selecting `cancel`, or an ACP `cancelled` outcome, still maps to `cancel`, exactly as today (#26's interrupt flow stays available).
- `docs/permission-extension.md`:
  - "Command and network decisions": say the adapter adds `decline` before `cancel` when Codex's list lacks it, and why.
  - "File changes": add the `No, continue without making these edits` → `decline` row, and drop the sentence about the native prompt not advertising it.
  - Keep "does not invent replacement choices" for everything else.

### Variant B (opt-in), if the maintainers prefer it

Same helpers, but gated. Read `_meta.codex.continueOnReject === true` from `session/new`, `session/load` and `session/resume` into the session state (like the `_meta.codex.strictMcpConfig` key proposed in open PR #548). Pass it to `commandDecisionOptions(params, continueOnReject)` and `fileChangeDecisionOptions(continueOnReject)` from `CodexApprovalHandler`. Document the key in `readme-dev.md` and `docs/permission-extension.md`. Without the flag, the behavior is byte-for-byte today's, so no existing test changes.

## Tests

`src/__tests__/CodexACPAgent/approval-events.test.ts`:

- Replace "supports the native accept-plus-cancel decision set without inventing decline" with "offers decline before cancel when Codex's decision set lacks it". `commandParams(["accept", "cancel"])` yields the option ids `[allow_once, decline, cancel]`, and selecting `decline` returns `{decision: "decline"}`. (Under variant B, keep the old test and add this one with the flag set.)
- "does not add decline to additional-permission requests": the legacy `additionalPermissions` fallback still yields `[allow_once, cancel]`.
- "keeps a single decline when Codex already advertises it": `["accept", "decline", "cancel"]` is unchanged.
- The existing "maps ACP cancellation to cancel, not decline" test still passes.
- File changes: "offers decline for file changes and maps it to decline", and the existing "distinguishes explicit file rejection from ACP cancellation" still returns `cancel` for `cancel` and for `cancelled`.
- Snapshot updates in `data/approval-file-change.json` and any command snapshot that lists options.

E2E (`acp-e2e-shell-approval.test.ts` and `acp-e2e-file-approval.test.ts`, read-only mode):

- "continues the turn when a workspace write is declined": the responder selects `ApprovalOptionId.Decline`, then `expectEndTurn(response)`, and the file doesn't exist.
- The same for an `apply_patch` edit.

Validation to fill in before opening:

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run test:e2e` for the new cases
- [ ] Manual probe under the `untrusted` mode: answering `decline` leaves the file unwritten and ends the turn with `end_turn`. (Result on 1.13.1 and Codex 0.156.1: confirmed for `echo … > shell.txt` and `apply_patch` of `notes.txt`.)

## Compatibility

- Additive for clients that choose by `optionId`: one more `reject_once` option appears in some prompts.
- Changes behavior for clients that answer with "the first `reject_once` option" or show only one reject button: a rejection there now continues the turn instead of cancelling it. Under variant B, nothing changes unless the client opts in.
- Relies on the app-server accepting `decline` for both request types, which is part of the generated v2 types (`CommandExecutionApprovalDecision` and `FileChangeApprovalDecision`), and was verified live on 0.156.1.
