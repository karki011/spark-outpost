import '../approvals/approval-card.css';
import './interrupted-card.css';
import { useId, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Interruption } from '@spark-outpost/contracts';
import { approvalKeys, approvalsApi } from '../../api/approvals.ts';
import { api, queryKeys } from '../../api/client.ts';
import { turnAnchor } from '../outline/outline-model.ts';
import {
  CONTINUE_LABEL,
  INTERRUPTED_TITLE,
  START_FRESH_LABEL,
  blockedText,
  filesText,
  stoppedText,
} from './interruption-model.ts';

interface InterruptedCardProps {
  interruption: Interruption;
  conversationId: string;
}

export function InterruptedCard({ interruption, conversationId }: InterruptedCardProps) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const messageId = useRef(crypto.randomUUID());
  const { runId } = interruption;
  const changes = useQuery({
    queryKey: approvalKeys.changes(runId),
    queryFn: () => approvalsApi.changes(runId),
  });
  const focusTurn = () =>
    document.getElementById(turnAnchor(runId))?.focus({ preventScroll: true });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.agentCommands(conversationId) }),
    ]);
  const proceed = useMutation({
    mutationFn: () => api.continueRun(runId, messageId.current),
    onSuccess: focusTurn,
    onSettled: refresh,
  });
  const startFresh = useMutation({
    mutationFn: () => api.startFreshAfter(runId),
    onSuccess: focusTurn,
    onSettled: refresh,
  });
  const busy = proceed.isPending || startFresh.isPending;
  const chosen = proceed.isSuccess || startFresh.isSuccess;
  const blocked = blockedText(interruption);
  const files = filesText(changes.data);
  const error = proceed.error ?? startFresh.error;
  return (
    <div className="appr interrupted" role="group" aria-labelledby={headingId}>
      <div className="appr-h">
        <span className="ic" aria-hidden="true">
          <i className="appr-dia still" />
        </span>
        <span id={headingId}>
          <b>{INTERRUPTED_TITLE}</b>
        </span>
      </div>
      <p>
        {stoppedText(interruption.stoppedAt)}
        {files ? ` ${files}` : ''} Nothing was retried.
      </p>
      {blocked && <p>{blocked}</p>}
      <div className="appr-acts">
        {!blocked && (
          <button
            type="button"
            className="btn primary sm"
            disabled={busy || chosen}
            onClick={() => proceed.mutate()}
          >
            {CONTINUE_LABEL}
          </button>
        )}
        <button
          type="button"
          className={blocked ? 'btn primary sm' : 'btn line sm'}
          disabled={busy || chosen}
          onClick={() => startFresh.mutate()}
        >
          {START_FRESH_LABEL}
        </button>
      </div>
      {error && (
        <p className="appr-err" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}
