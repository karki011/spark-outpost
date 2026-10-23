import { AskIcon, CheckIcon, PauseIcon } from '../ui/icons.tsx';
import type { ThreadStatus } from './thread-cards.ts';

function PillIcon({ status }: { status: ThreadStatus }) {
  if (status === 'working') return <i className="op-orb" aria-hidden="true" />;
  if (status === 'waiting') return <AskIcon />;
  if (status === 'held') return <PauseIcon />;
  if (status === 'done') return <CheckIcon />;
  return null;
}

export function StatusPill({ status, label }: { status: ThreadStatus; label: string }) {
  return (
    <span className={`op-pill ${status}`}>
      <PillIcon status={status} />
      {label}
    </span>
  );
}
