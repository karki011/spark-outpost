import { useState } from 'react';
import { terminalDependenciesText, type NativeTerminalSession } from '@spark-outpost/contracts';
import { XIcon } from '../ui/icons.tsx';

export function DependenciesNotice({ session }: { session: NativeTerminalSession }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const dependencies = session.dependencies;
  if (!dependencies) return null;
  const text = terminalDependenciesText(dependencies);
  const key = `${session.id}:${dependencies.state}:${text}`;
  if (dismissed === key) return null;
  return (
    <p className="native-note native-restart" role="status">
      <span>{text}</span>
      <button
        type="button"
        className="icon-btn"
        aria-label="Dismiss"
        onClick={() => setDismissed(key)}
      >
        <XIcon />
      </button>
    </p>
  );
}
