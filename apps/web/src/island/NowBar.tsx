import type { ConversationSummary } from '@spark-outpost/contracts';
import { rowState } from '../conversations/row-state.ts';
import { sessionState, type Card, type SessionState } from './island-model.ts';
import { RunDots } from './island-parts.tsx';

interface NowBarProps {
  chat: ConversationSummary | null;
  card: Card | null;
  onReview: (card: Card) => void;
}

const QUIET_LINES: Record<SessionState, string> = {
  working: 'Working',
  waiting: 'Needs you',
  done: 'Done',
  failed: 'Couldn’t finish',
  idle: 'Quiet',
};

export function nowLine(chat: ConversationSummary): string {
  const state = sessionState(chat);
  return rowState(chat, false).sub || QUIET_LINES[state];
}

export function NowBar({ chat, card, onReview }: NowBarProps) {
  const shown = card?.chat ?? chat;
  const state = shown ? sessionState(shown) : 'idle';
  return (
    <div className="isl-nowbar" data-state={state} role="status">
      <div className="isl-nowbar-text">
        <b className="isl-nowbar-title">{shown?.title ?? 'Spark'}</b>
        <span className="isl-nowbar-line">{shown ? nowLine(shown) : 'Nothing running'}</span>
      </div>
      {card ? (
        <button type="button" className="isl-btn primary" onClick={() => onReview(card)}>
          Review
        </button>
      ) : (
        state === 'working' && <RunDots />
      )}
    </div>
  );
}
