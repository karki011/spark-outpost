import { useState } from 'react';
import type { NativeTerminalSession } from '@spark-outpost/contracts';
import { XIcon } from '../ui/icons.tsx';
import { dismiss, isDismissed, noticeKey, restartNoticeText } from './restart-notice.ts';

const clock = (at: Date) => at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function RestartNotice({ session }: { session: NativeTerminalSession }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const readopted = session.readopted;
  if (!readopted) return null;
  const key = noticeKey(session.id, readopted);
  if (dismissed === key || isDismissed(key, window.localStorage)) return null;
  return (
    <p className="native-note native-restart" role="status">
      <span>{restartNoticeText(readopted, clock)}</span>
      <button
        type="button"
        className="icon-btn"
        aria-label="Dismiss"
        onClick={() => {
          dismiss(key, window.localStorage);
          setDismissed(key);
        }}
      >
        <XIcon />
      </button>
    </p>
  );
}
