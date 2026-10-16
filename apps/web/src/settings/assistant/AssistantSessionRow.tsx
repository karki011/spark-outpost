import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AssistantSettingsView } from '@spark-outpost/contracts';
import { assistantApi, assistantKeys } from '../../api/assistant.ts';
import { AuditDialog } from '../../audit/AuditDialog.tsx';
import { BlobToggle } from '../../brand/BlobToggle.tsx';
import { SettingRow } from '../SettingRow.tsx';
import { sessionLine } from './assistant-hints.ts';

const BUSY_HINT = 'Ask Spark is answering. Clear history once it finishes.';

interface AssistantSessionRowProps {
  view: AssistantSettingsView;
  onOpenChat: (conversationId: string) => void;
}

export function AssistantSessionRow({ view, onOpenChat }: AssistantSessionRowProps) {
  const hintId = useId();
  const confirmId = useId();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [alsoFacts, setAlsoFacts] = useState(false);
  const [audit, setAudit] = useState(false);
  const clear = useMutation({
    mutationFn: () => assistantApi.clear(alsoFacts),
    onSuccess: (next) => {
      queryClient.setQueryData(assistantKeys.settings, next);
      setConfirming(false);
      setAlsoFacts(false);
    },
  });
  const conversationId = view.conversationId;
  const hint =
    clear.error?.message ?? (view.busy ? BUSY_HINT : (view.notice ?? sessionLine(view.session)));

  return (
    <SettingRow label="Session" hint={hint} hintId={hintId}>
      <div className="assistant-session">
        <button
          type="button"
          className="btn sm"
          disabled={!conversationId}
          onClick={() => conversationId && onOpenChat(conversationId)}
        >
          View conversation
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={!conversationId}
          onClick={() => setAudit(true)}
        >
          Audit
        </button>
        {!confirming && (
          <button
            type="button"
            className="btn sm"
            disabled={!conversationId || view.busy}
            onClick={() => setConfirming(true)}
          >
            Clear history…
          </button>
        )}
      </div>
      {confirming && (
        <div className="assistant-clear" role="group" aria-labelledby={confirmId}>
          <p id={confirmId} className="set-hint">
            Ask Spark starts a new session without this history. Its runs stay in Usage and Audit.
          </p>
          <label className="check-row">
            <BlobToggle
              size="sm"
              label="Also clear key facts"
              checked={alsoFacts}
              onChange={setAlsoFacts}
            />
            <span>Also clear key facts</span>
          </label>
          <div className="assistant-session">
            <button
              type="button"
              className="btn primary sm"
              disabled={clear.isPending || view.busy}
              onClick={() => clear.mutate()}
            >
              Clear history
            </button>
            <button type="button" className="btn sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {audit && conversationId && (
        <AuditDialog
          conversationId={conversationId}
          title="Ask Spark"
          onClose={() => setAudit(false)}
        />
      )}
    </SettingRow>
  );
}
