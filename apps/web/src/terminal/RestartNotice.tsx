import { useState } from 'react';
import type { NativeTerminalSession } from '@spark-outpost/contracts';
import { DismissibleNote } from './DismissibleNote.tsx';
import { dismiss, isDismissed, noticeKey, restartNoticeText } from './restart-notice.ts';

const clock = (at: Date) => at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function RestartNotice({ session }: { session: NativeTerminalSession }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const readopted = session.readopted;
  if (!readopted) return null;
  const key = noticeKey(session.id, readopted);
  if (dismissed === key || isDismissed(key, window.localStorage)) return null;
  return (
    <DismissibleNote
      text={restartNoticeText(readopted, clock)}
      onDismiss={() => {
        dismiss(key, window.localStorage);
        setDismissed(key);
      }}
    />
  );
}
