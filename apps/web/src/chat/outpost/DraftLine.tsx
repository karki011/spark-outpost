import './outpost-chat.css';
import type { ChatDraft } from '@spark-outpost/contracts';
import { ChevronIcon, OutpostIcon } from '../../ui/icons.tsx';
import { draftLabel } from './chat-lines.ts';

interface DraftLineProps {
  draft: Pick<ChatDraft, 'chats' | 'stacked' | 'startedAt'>;
  outpostName?: string | null | undefined;
  onReview?: (() => void) | undefined;
  onOpenOutpost?: (() => void) | undefined;
}

export function DraftLine({ draft, outpostName, onReview, onOpenOutpost }: DraftLineProps) {
  const started = draft.startedAt !== null;
  return (
    <p className="ai-note op-line">
      <OutpostIcon />
      <span className="op-line-lead">{draftLabel(draft)}</span>
      {started && outpostName && <span className="op-line-text">{outpostName}</span>}
      {!started && !onReview && <span className="op-line-text">Review and start on your Mac</span>}
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
          Open outpost
          <ChevronIcon />
        </button>
      )}
    </p>
  );
}
