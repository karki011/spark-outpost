import { useState } from 'react';
import { friendlyStep, type TerminalApproval } from '@spark-outpost/contracts';
import { PHONE_SWITCH_OFF } from '../../phone/use-remote-client.ts';

export function RemoteTerminalApproval({
  approval,
  allowed,
  onDecide,
}: {
  approval: TerminalApproval;
  allowed: boolean;
  onDecide: (decision: 'allow' | 'deny') => Promise<unknown>;
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
  return (
    <section className="rt-approval" aria-labelledby="rt-approval-title">
      <h2 id="rt-approval-title">Permission needed: {friendlyStep(approval.tool)}</h2>
      {approval.detail && <pre className="rt-approval-detail">{approval.detail}</pre>}
      {allowed ? (
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
      ) : (
        <p className="rt-note">
          {PHONE_SWITCH_OFF}: approving in Terminal sessions. Answer on your Mac.
        </p>
      )}
    </section>
  );
}
