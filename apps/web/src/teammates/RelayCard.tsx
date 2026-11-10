import './relay.css';
import type { CSSProperties, ReactNode } from 'react';
import {
  RELAY_PULL_STATE_LABELS,
  type RelayPull,
  type RelayPullState,
  type RelayWatch,
  type TeammateView,
} from '@spark-outpost/contracts';
import { CheckIcon, EyeIcon, PauseIcon, PenIcon, RefreshIcon, WarnIcon } from '../ui/icons.tsx';
import { TeammateFace } from './TeammateFace.tsx';
import { openTeammateSheet } from './teammate-store.ts';

const STATE_ICONS: Record<RelayPullState, () => ReactNode> = {
  watching: () => <EyeIcon />,
  round: () => <RefreshIcon />,
  needs_you: () => <WarnIcon />,
  stopped: () => <PauseIcon />,
  clean: () => <CheckIcon />,
};

export function relaySummary(watch: RelayWatch | undefined): string {
  if (!watch) return 'Follows up on pull requests';
  if (watch.followUp === 'off') return 'Follow up on pull requests is off';
  const count = watch.pulls.length;
  if (count === 0) return 'No open pull requests to watch';
  const pulls = `${count} ${count === 1 ? 'pull request' : 'pull requests'}`;
  return watch.followUp === 'ask' ? `Asks first · ${pulls}` : `Watching ${pulls}`;
}

function PullRow({ pull, onOpen }: { pull: RelayPull; onOpen: (id: string) => void }) {
  const label = RELAY_PULL_STATE_LABELS[pull.state];
  return (
    <li>
      <button
        type="button"
        className="relay-pull"
        aria-label={`Open ${pull.chatTitle}, pull request #${pull.number}: ${label}`}
        onClick={() => onOpen(pull.conversationId)}
      >
        <span className="relay-pull-number">#{pull.number}</span>
        <span className="relay-pull-chat">{pull.chatTitle}</span>
        <span className={`relay-pull-state ${pull.state}`}>
          {STATE_ICONS[pull.state]()}
          {label}
        </span>
      </button>
    </li>
  );
}

interface RelayCardProps {
  teammate: TeammateView;
  style: CSSProperties;
  opening: boolean;
  onOpen: () => void;
  onOpenChat: (conversationId: string) => void;
}

export function RelayCard({ teammate, style, opening, onOpen, onOpenChat }: RelayCardProps) {
  const watch = teammate.relay;
  const summary = relaySummary(watch);
  const pulls = watch && watch.followUp !== 'off' ? watch.pulls : [];
  return (
    <li className={`tm-card tm-relay st-${teammate.state}`} style={style}>
      <button
        type="button"
        className="tm-open"
        aria-label={`Open ${teammate.name}'s chat. ${summary}`}
        disabled={opening}
        onClick={onOpen}
      >
        <span className="tm-blob">
          <TeammateFace face={teammate.face} state={teammate.state} size={44} />
        </span>
        <b className="tm-name">{teammate.name}</b>
        <span className="tm-role">{teammate.role || 'Spark'}</span>
        <small className="tm-last">{summary}</small>
      </button>
      {pulls.length > 0 && (
        <ul className="relay-pulls" aria-label={`Pull requests ${teammate.name} is watching`}>
          {pulls.map((pull) => (
            <PullRow key={pull.id} pull={pull} onOpen={onOpenChat} />
          ))}
        </ul>
      )}
      <button
        type="button"
        className="icon-btn tm-edit"
        aria-label={`Edit ${teammate.name}`}
        title="Edit"
        onClick={() => openTeammateSheet({ kind: 'edit', id: teammate.id })}
      >
        <PenIcon />
      </button>
    </li>
  );
}
