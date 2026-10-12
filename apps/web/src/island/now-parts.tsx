import { useRef, type MouseEvent } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import type { SessionState } from './island-model.ts';
import { RunDots } from './island-parts.tsx';

const HOLD_MS = 550;

export interface QuickStart {
  id: string;
  name: string;
}

export function StateBadge({ state }: { state: SessionState }) {
  switch (state) {
    case 'working':
      return (
        <span className="isl-now-badge run" aria-hidden="true">
          <RunDots />
        </span>
      );
    case 'waiting':
      return (
        <span className="isl-now-badge wait" aria-hidden="true">
          !
        </span>
      );
    case 'done':
      return (
        <span className="isl-now-badge ok" aria-hidden="true">
          ✓
        </span>
      );
    case 'failed':
      return (
        <span className="isl-now-badge bad" aria-hidden="true">
          !
        </span>
      );
    default:
      return null;
  }
}

interface OpenButtonProps {
  chat: ConversationSummary;
  onOpenHere: (id: string) => void;
  onOpenChat: (id: string) => void;
}

export function OpenButton({ chat, onOpenHere, onOpenChat }: OpenButtonProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const release = () => clearTimeout(timer.current);
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (held.current) {
      held.current = false;
      return;
    }
    if (event.metaKey || event.ctrlKey) onOpenChat(chat.id);
    else onOpenHere(chat.id);
  };
  return (
    <button
      type="button"
      className="isl-now-open"
      aria-label={`Open ${chat.title}`}
      title="Open here · ⌘-click or hold to open in Spark"
      onClick={onClick}
      onPointerDown={() => {
        held.current = false;
        timer.current = setTimeout(() => {
          held.current = true;
          onOpenChat(chat.id);
        }, HOLD_MS);
      }}
      onPointerUp={release}
      onPointerLeave={release}
    >
      Open
    </button>
  );
}

interface NowEmptyProps {
  quickStart: QuickStart | null;
  onAsk: () => void;
  onNewIn: (projectId: string) => void;
}

export function NowEmpty({ quickStart, onAsk, onNewIn }: NowEmptyProps) {
  return (
    <div className="isl-now-text">
      <div className="isl-now-head">
        <b className="isl-now-title">All quiet</b>
      </div>
      <p className="isl-now-status">Nothing is running. Start something?</p>
      <div className="isl-now-acts">
        <button type="button" className="isl-btn" onClick={onAsk}>
          Ask Spark…
        </button>
        {quickStart && (
          <button
            type="button"
            className="isl-btn"
            title={`New chat in ${quickStart.name}`}
            onClick={() => onNewIn(quickStart.id)}
          >
            <span className="isl-now-actname">New chat in {quickStart.name}</span>
          </button>
        )}
      </div>
    </div>
  );
}
