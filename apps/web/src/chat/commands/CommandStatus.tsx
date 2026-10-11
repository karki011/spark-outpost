import { useEffect, useState } from 'react';
import { CheckIcon, XIcon } from '../../ui/icons.tsx';
import { commandSeconds, shownDuration, type CommandView } from './command-model.ts';

export function Elapsed({ command }: { command: CommandView }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{shownDuration(commandSeconds(command, now))}</>;
}

export function StatusMark({ command, waiting }: { command: CommandView; waiting: boolean }) {
  if (command.status === 'running') {
    return <span className={waiting ? 'run-cmd-wait' : 'spin'} aria-hidden="true" />;
  }
  return (
    <span className="run-cmd-mark" aria-hidden="true">
      {command.status === 'completed' ? <CheckIcon className="run-cmd-ok" /> : <XIcon />}
    </span>
  );
}

export function stateText(command: CommandView): string {
  if (command.status === 'interrupted') return 'interrupted';
  const took = shownDuration(commandSeconds(command, Date.now()));
  if (command.exitCode !== null) return `exit ${command.exitCode} · ${took}`;
  return `${command.status === 'failed' ? 'failed' : 'done'} · ${took}`;
}
