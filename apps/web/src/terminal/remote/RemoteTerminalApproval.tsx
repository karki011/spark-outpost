import { useId, useState } from 'react';
import {
  friendlyStep,
  TERMINAL_DENY_REASON_MAX_LENGTH,
  type TerminalApproval,
  type TerminalApprovalDecision,
} from '@spark-outpost/contracts';
import { PHONE_SWITCH_OFF } from '../../phone/use-remote-client.ts';

type Answer = Omit<TerminalApprovalDecision, 'id'>;

export function RemoteTerminalApproval({
  approval,
  allowed,
  onDecide,
}: {
  approval: TerminalApproval;
  allowed: boolean;
  onDecide: (answer: Answer) => Promise<unknown>;
}) {
  return (
    <section className="rt-approval" aria-labelledby="rt-approval-title">
      <h2 id="rt-approval-title">Permission needed: {friendlyStep(approval.tool)}</h2>
      {approval.detail && <pre className="rt-approval-detail">{approval.detail}</pre>}
      {allowed ? (
        <ApprovalActions denyLabel={denyLabel(approval)} onDecide={onDecide} />
      ) : (
        <p className="rt-note">
          {PHONE_SWITCH_OFF}: approving in Terminal sessions. Answer on your Mac.
        </p>
      )}
    </section>
  );
}

function denyLabel(approval: TerminalApproval): string {
  return approval.denyStopsTurn ? 'Deny and stop the turn' : 'Deny';
}

function ApprovalActions({
  denyLabel,
  onDecide,
}: {
  denyLabel: string;
  onDecide: (answer: Answer) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const reasonId = useId();
  const decide = async (answer: Answer) => {
    setBusy(true);
    try {
      await onDecide(answer);
    } finally {
      setBusy(false);
    }
  };
  const deny = () => {
    const typed = reason.trim();
    void decide(typed ? { decision: 'deny', reason: typed } : { decision: 'deny' });
  };
  if (!denying)
    return (
      <div className="rt-approval-actions">
        <button type="button" className="btn line" disabled={busy} onClick={() => setDenying(true)}>
          {denyLabel}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => void decide({ decision: 'allow' })}
        >
          Allow
        </button>
      </div>
    );
  return (
    <form
      className="rt-deny"
      onSubmit={(event) => {
        event.preventDefault();
        deny();
      }}
    >
      <label htmlFor={reasonId}>Tell the agent why (optional)</label>
      <input
        id={reasonId}
        className="inp"
        type="text"
        autoFocus
        autoComplete="off"
        enterKeyHint="send"
        value={reason}
        maxLength={TERMINAL_DENY_REASON_MAX_LENGTH}
        onChange={(event) => setReason(event.target.value)}
        onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'nearest' })}
      />
      <div className="rt-approval-actions">
        <button
          type="button"
          className="btn line"
          disabled={busy}
          onClick={() => setDenying(false)}
        >
          Back
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {denyLabel}
        </button>
      </div>
    </form>
  );
}
