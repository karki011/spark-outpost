import type { CSSProperties, ReactElement } from 'react';
import type { RunStatus } from '@spark-outpost/contracts';
import { ClockIcon, PauseIcon, SpinnerIcon, XIcon } from '../ui/icons.tsx';
import type { RunningOverlay } from './use-running-overlay.ts';
import './map-running.css';

const STATE: Record<string, { word: string; icon: () => ReactElement }> = {
  running: { word: 'Running', icon: SpinnerIcon },
  queued: { word: 'Queued', icon: ClockIcon },
  awaiting_approval: { word: 'Waiting for you', icon: PauseIcon },
};

export function statusWord(status: RunStatus): string {
  return STATE[status]?.word ?? 'Working';
}

interface RunningChatsPanelProps {
  overlay: RunningOverlay;
  inset: number;
  onGoTo: (projectId: string, path: string) => void;
  onOpenChat: (id: string) => void;
}

export function RunningChatsPanel({ overlay, inset, onGoTo, onOpenChat }: RunningChatsPanelProps) {
  const { chats, marks, focused } = overlay;
  const pick = (id: string) => {
    const next = focused === id ? null : id;
    overlay.setFocused(next);
    const chat = chats.find((entry) => entry.id === next);
    if (chat?.paths[0]) onGoTo(chat.projectId, chat.paths[0]);
  };
  return (
    <section
      className="map-running map-glass"
      aria-labelledby="map-running-title"
      style={{ '--map-running-inset': `${inset}px` } as CSSProperties}
      data-map-overlay
    >
      <h3 id="map-running-title">
        Running chats
        <button type="button" aria-label="Hide running chats" onClick={() => overlay.setOn(false)}>
          <XIcon />
        </button>
      </h3>
      {chats.length === 0 ? (
        <p className="map-running-none">No chat is working in this project right now.</p>
      ) : (
        <ul>
          {chats.map((chat) => {
            const state = STATE[chat.status];
            const Icon = state?.icon ?? SpinnerIcon;
            const files = marks.perChat.find((entry) => entry.id === chat.id)?.files ?? 0;
            return (
              <li key={chat.id} data-focused={focused === chat.id || undefined}>
                <button
                  type="button"
                  className="map-running-pick"
                  aria-pressed={focused === chat.id}
                  onClick={() => pick(chat.id)}
                >
                  <span className="map-running-state">
                    <Icon />
                    {statusWord(chat.status)}
                  </span>
                  <span className="map-running-title">{chat.title}</span>
                  <small>{files === 1 ? '1 file' : `${files} files`}</small>
                </button>
                <button type="button" className="map-btn" onClick={() => onOpenChat(chat.id)}>
                  Open chat
                  <span className="sr-only">: {chat.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
