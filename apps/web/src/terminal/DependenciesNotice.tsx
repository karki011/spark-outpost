import { useState } from 'react';
import { terminalDependenciesText, type NativeTerminalSession } from '@spark-outpost/contracts';
import { DismissibleNote } from './DismissibleNote.tsx';

export function DependenciesNotice({ session }: { session: NativeTerminalSession }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const dependencies = session.dependencies;
  if (!dependencies) return null;
  const text = terminalDependenciesText(dependencies);
  const key = `${session.id}:${dependencies.state}:${text}`;
  if (dismissed === key) return null;
  return <DismissibleNote text={text} onDismiss={() => setDismissed(key)} />;
}
