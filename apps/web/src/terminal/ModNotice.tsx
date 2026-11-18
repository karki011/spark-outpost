import { useState } from 'react';
import { terminalModText, type NativeTerminalSession } from '@spark-outpost/contracts';
import { DismissibleNote } from './DismissibleNote.tsx';

export function ModNotice({ session }: { session: NativeTerminalSession }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const text = session.mod ? terminalModText(session.mod) : null;
  if (!text) return null;
  const key = `${session.id}:${text}`;
  if (dismissed === key) return null;
  return <DismissibleNote text={text} onDismiss={() => setDismissed(key)} />;
}
