import { isMcpToolName } from '@spark-outpost/contracts';
import { useEffect, useState } from 'react';
import { CheckIcon, PauseIcon, XIcon } from '../../ui/icons.tsx';
import { commandSeconds, shownDuration, type CommandView } from './command-model.ts';

export function Elapsed({ command }: { command: CommandView }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{shownDuration(commandSeconds(command, now))}</>;
}

interface CommandWordProps {
  command: CommandView;
  waiting: boolean;
  denied?: boolean;
}

export function CommandWord({ command, waiting, denied = false }: CommandWordProps) {
  if (denied && command.status !== 'running') {
    return (
      <span className="trow-word bad">
        <XIcon />
        denied
      </span>
    );
  }
  if (command.status === 'running') {
    if (waiting) return <span className="trow-word">waiting for you</span>;
    return (
      <span className="trow-word">
        <span className="spin trow-spin" aria-hidden="true" />
        <Elapsed command={command} />
      </span>
    );
  }
  if (command.status === 'interrupted') {
    return (
      <span className="trow-word">
        <PauseIcon />
        interrupted
      </span>
    );
  }
  const ended = Date.parse(command.finishedAt ?? command.startedAt);
  const took = shownDuration(commandSeconds(command, ended));
  if (command.status === 'failed') {
    const code = command.exitCode === null ? '' : ` · exit ${command.exitCode}`;
    return (
      <span className="trow-word bad">
        <XIcon />
        failed{code} · {took}
      </span>
    );
  }
  return (
    <span className="trow-word ok">
      <CheckIcon className="ok" />
      {isMcpToolName(command.command) ? 'done' : 'passed'} · {took}
    </span>
  );
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
