import { useState } from 'react';
import type { TerminalApproval } from '@spark-outpost/contracts';
import { PHONE_SWITCH_OFF } from '../../phone/use-remote-client.ts';

export function RemoteTerminalApproval({
  approval,
  here,
  allowed,
  onDecide,
}: {
  approval: TerminalApproval;
  here: boolean;
  allowed: boolean;
  onDecide: (decision: 'allow' | 'deny') => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'allow' | 'deny') => {
    setBusy(true);
    try {
      await onDecide(decision);
    } finally {
      setBusy(false);
    }
  };
  const note = !allowed
    ? `${PHONE_SWITCH_OFF}: approving in Terminal sessions. Answer on your Mac.`
    : here
      ? null
      : 'This session started before approving from a paired device was possible. Answer on your Mac.';
  return (
    <section className="rt-approval" aria-labelledby="rt-approval-title">
      <h2 id="rt-approval-title">The agent wants to use {approval.tool}</h2>
      {approval.detail && <pre className="rt-approval-detail">{approval.detail}</pre>}
      {note ? (
        <p className="rt-note">{note}</p>
      ) : (
        <div className="rt-approval-actions">
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void decide('allow')}
          >
            Allow
          </button>
          <button
            type="button"
            className="btn line"
            disabled={busy}
            onClick={() => void decide('deny')}
          >
            {approval.denyStopsTurn ? 'Deny and stop the turn' : 'Deny'}
          </button>
        </div>
      )}
    </section>
  );
}
