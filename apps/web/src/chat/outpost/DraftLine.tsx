import './outpost-chat.css';
import type { ChatDraft } from '@spark-outpost/contracts';
import { ChevronIcon, OutpostIcon } from '../../ui/icons.tsx';
import { draftLabel } from './chat-lines.ts';

export interface DraftStartState {
  onStart: () => void;
  pending: boolean;
  error: string | null;
}

interface DraftLineProps {
  draft: Pick<ChatDraft, 'chats' | 'stacked' | 'startedAt'>;
  outpostName?: string | null | undefined;
  onReview?: (() => void) | undefined;
  start?: DraftStartState | undefined;
  onOpenOutpost?: (() => void) | undefined;
}

function StartButton({ start }: { start: DraftStartState }) {
  return (
    <>
      <button type="button" className="from-open" disabled={start.pending} onClick={start.onStart}>
        {start.pending ? 'Starting…' : 'Start'}
        <ChevronIcon />
      </button>
      {start.error && (
        <span className="op-line-text" role="alert">
          {start.error}
        </span>
      )}
    </>
  );
}

export function DraftLine({ draft, outpostName, onReview, start, onOpenOutpost }: DraftLineProps) {
  const started = draft.startedAt !== null;
  const waiting = !started && !onReview;
  return (
    <p className="ai-note op-line">
      <OutpostIcon />
      <span className="op-line-lead">{draftLabel(draft, outpostName)}</span>
      {waiting && !start && <span className="op-line-text">Review and start on your Mac</span>}
      {waiting && start && <StartButton start={start} />}
      {!started && onReview && (
        <button type="button" className="from-open" onClick={onReview}>
          Review and start
          <ChevronIcon />
        </button>
      )}
      {started && onOpenOutpost && (
        <button
          type="button"
          className="from-open"
          aria-label={outpostName ? `Open outpost ${outpostName}` : 'Open the outpost'}
          onClick={onOpenOutpost}
        >
          Open
          <ChevronIcon />
        </button>
      )}
    </p>
  );
}
