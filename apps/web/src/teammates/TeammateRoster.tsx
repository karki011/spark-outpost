import type { CSSProperties } from 'react';
import { useMutation } from '@tanstack/react-query';
import { TEAMMATE_STATE_LABELS, type TeammateView } from '@spark-outpost/contracts';
import { HomeCard } from '../home/HomeCards.tsx';
import { openSparksPage } from '../sparks-page/sparks-route.ts';
import { PenIcon, PlusIcon } from '../ui/icons.tsx';
import { StarterSuggestions } from './StarterSuggestions.tsx';
import { TeammateFace } from './TeammateFace.tsx';
import { activityLine } from './teammate-lines.ts';
import { openTeammateSheet } from './teammate-store.ts';
import { teammatesApi } from './teammates-api.ts';
import { useTeammates } from './use-teammates.ts';

interface TeammateRosterProps {
  now: number;
  onOpenId: (conversationId: string) => void;
}

const stagger = (index: number) => ({ '--i': index }) as CSSProperties;

interface CardProps {
  teammate: TeammateView;
  index: number;
  now: number;
  opening: boolean;
  onOpen: () => void;
}

function TeammateCard({ teammate, index, now, opening, onOpen }: CardProps) {
  const line = activityLine(teammate, now);
  return (
    <li className={`tm-card st-${teammate.state}`} style={stagger(index)}>
      <button
        type="button"
        className="tm-open"
        aria-label={`Open ${teammate.name}'s chat. ${TEAMMATE_STATE_LABELS[teammate.state]}. ${line}`}
        disabled={opening}
        onClick={onOpen}
      >
        <span className="tm-blob">
          <TeammateFace face={teammate.face} state={teammate.state} size={44} />
          {teammate.state !== 'idle' && <i className={`tm-dot ${teammate.state}`} />}
        </span>
        <b className="tm-name">{teammate.name}</b>
        <span className="tm-role">{teammate.role || 'Spark'}</span>
        <small className="tm-last">{line}</small>
      </button>
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

function RosterSkeleton() {
  return (
    <section className="hsec" aria-hidden="true">
      <div className="hsec-h">
        <span className="hsk" style={{ width: 96, height: 14 }} />
      </div>
      <ul className="tm-roster">
        {[0, 1, 2].map((key) => (
          <li key={key} className="tm-card tm-sk">
            <span className="hsk dot" />
            <span className="hsk" style={{ width: '60%' }} />
            <span className="hsk" style={{ width: '80%' }} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TeammateRoster({ now, onOpenId }: TeammateRosterProps) {
  const { loading, teammates, starters } = useTeammates();
  const open = useMutation({
    mutationFn: teammatesApi.openHome,
    onSuccess: (chat) => onOpenId(chat.conversationId),
  });
  if (loading) return <RosterSkeleton />;
  return (
    <HomeCard
      id="home-sparks"
      title="Your Sparks"
      className="tm-section"
      action={
        <button type="button" className="btn ghost sm" onClick={() => openSparksPage()}>
          Manage
        </button>
      }
    >
      {teammates.length === 0 ? (
        <StarterSuggestions starters={starters} />
      ) : (
        <ul className="tm-roster">
          {teammates.map((teammate, index) => (
            <TeammateCard
              key={teammate.id}
              teammate={teammate}
              index={index}
              now={now}
              opening={open.isPending && open.variables === teammate.id}
              onOpen={() => open.mutate(teammate.id)}
            />
          ))}
          <li className="tm-card tm-add" style={stagger(teammates.length)}>
            <button
              type="button"
              className="tm-open"
              onClick={() => openTeammateSheet({ kind: 'create' })}
            >
              <span className="tm-blob tm-plus" aria-hidden="true">
                <PlusIcon />
              </span>
              <b className="tm-name">New Spark</b>
            </button>
          </li>
        </ul>
      )}
      {open.isError && (
        <p className="tm-error" role="alert">
          {open.error.message}
        </p>
      )}
    </HomeCard>
  );
}
