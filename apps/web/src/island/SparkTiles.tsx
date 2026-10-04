import type { CSSProperties } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TeammateFace as Face, TeammateState, TeammateView } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { TeammateFace } from '../teammates/TeammateFace.tsx';
import { teammatesApi } from '../teammates/teammates-api.ts';
import { useTeammates } from '../teammates/use-teammates.ts';
import { PlusIcon } from '../ui/icons.tsx';
import type { QuickStart } from './NowCard.tsx';

interface SparkTilesProps {
  waiting: number;
  quickStart: QuickStart | null;
  onOpenHere: (id: string) => void;
  onNewIn: (projectId: string | null) => void;
  onAsk: () => void;
  onChats: () => void;
  onMakeSpark: (() => void) | null;
  onEditSpark: ((id: string) => void) | null;
}

const STATE_WORDS: Record<TeammateState, string | null> = {
  idle: null,
  working: 'working',
  needs_you: 'needs you',
  done: 'done',
  failed: 'failed',
};

interface QuickAction {
  id: string;
  label: string;
  face: Face;
  badge?: number;
  run: () => void;
}

function tileStyle(index: number): CSSProperties {
  return { '--i': index } as CSSProperties;
}

function TileSkeleton() {
  return (
    <section className="isl-hcard isl-tiles" aria-busy="true" style={tileStyle(1)}>
      <p className="sr-only" role="status">
        Finding your Sparks
      </p>
      <div className="isl-tilegrid" aria-hidden="true">
        {[0, 1, 2, 3].map((slot) => (
          <span key={slot} className="isl-tile isl-tile-skl" />
        ))}
      </div>
    </section>
  );
}

function SparkTile({
  teammate,
  index,
  opening,
  onOpen,
  onEdit,
}: {
  teammate: TeammateView;
  index: number;
  opening: boolean;
  onOpen: () => void;
  onEdit: (() => void) | null;
}) {
  const state = STATE_WORDS[teammate.state];
  const role = teammate.role.trim();
  const words = [`Chat with ${teammate.name}`, role, state].filter(Boolean).join(', ');
  const hint = [role || teammate.name, onEdit ? 'Right-click to edit or delete' : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <button
      type="button"
      className="isl-tile"
      style={tileStyle(index)}
      aria-label={words}
      title={hint}
      aria-busy={opening || undefined}
      data-state={teammate.state}
      onClick={onOpen}
      onContextMenu={(event) => {
        if (!onEdit) return;
        event.preventDefault();
        onEdit();
      }}
    >
      <span className="isl-tile-face" aria-hidden="true">
        <TeammateFace face={teammate.face} size={28} state={teammate.state} />
      </span>
      <span className="isl-tile-text">
        <span className="isl-tile-name">{teammate.name}</span>
        {role && <span className="isl-tile-role">{role}</span>}
      </span>
    </button>
  );
}

function NewSparkTile({ index, onMake }: { index: number; onMake: () => void }) {
  return (
    <button
      type="button"
      className="isl-tile isl-tile-new"
      style={tileStyle(index)}
      title="Opens in Spark"
      onClick={onMake}
    >
      <span className="isl-tile-face" aria-hidden="true">
        <PlusIcon />
      </span>
      <span className="isl-tile-text">
        <span className="isl-tile-name">New Spark</span>
      </span>
    </button>
  );
}

function ActionTile({ action, index }: { action: QuickAction; index: number }) {
  return (
    <button type="button" className="isl-tile" style={tileStyle(index)} onClick={action.run}>
      <span className="isl-tile-face" aria-hidden="true">
        <TeammateFace face={action.face} size={28} />
      </span>
      <span className="isl-tile-text">
        <span className="isl-tile-name">{action.label}</span>
      </span>
      {action.badge ? (
        <span className="isl-badge" aria-label={`${action.badge} waiting`}>
          {action.badge}
        </span>
      ) : null}
    </button>
  );
}

function quickActions(props: SparkTilesProps): QuickAction[] {
  const actions: QuickAction[] = [
    {
      id: 'new',
      label: props.quickStart ? `New in ${props.quickStart.name}` : 'New chat',
      face: { shape: 'cloud', color: 'sky' },
      run: () => props.onNewIn(props.quickStart?.id ?? null),
    },
    { id: 'ask', label: 'Ask Spark', face: { shape: 'round', color: 'teal' }, run: props.onAsk },
    {
      id: 'needs',
      label: 'Needs you',
      face: { shape: 'nub', color: 'gold' },
      badge: props.waiting,
      run: props.onChats,
    },
  ];
  const make = props.onMakeSpark;
  actions.push(
    make
      ? { id: 'make', label: 'New Spark', face: { shape: 'sun', color: 'plum' }, run: make }
      : {
          id: 'chats',
          label: 'All chats',
          face: { shape: 'capsule', color: 'violet' },
          run: props.onChats,
        },
  );
  return actions;
}

export function SparkTiles(props: SparkTilesProps) {
  const { loading, teammates } = useTeammates();
  const queryClient = useQueryClient();
  const open = useMutation({
    mutationFn: teammatesApi.openHome,
    onSuccess: (chat) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      props.onOpenHere(chat.conversationId);
    },
  });
  if (loading) return <TileSkeleton />;
  const sparks = teammates.length > 0;
  const { onMakeSpark, onEditSpark } = props;
  return (
    <section
      className="isl-hcard isl-tiles"
      aria-label={sparks ? 'Your Sparks' : 'Quick start'}
      style={tileStyle(1)}
    >
      <div className="isl-tilegrid">
        {sparks
          ? teammates.map((teammate, index) => (
              <SparkTile
                key={teammate.id}
                teammate={teammate}
                index={index}
                opening={open.isPending && open.variables === teammate.id}
                onOpen={() => open.mutate(teammate.id)}
                onEdit={onEditSpark && (() => onEditSpark(teammate.id))}
              />
            ))
          : quickActions(props).map((action, index) => (
              <ActionTile key={action.id} action={action} index={index} />
            ))}
        {sparks && onMakeSpark && <NewSparkTile index={teammates.length} onMake={onMakeSpark} />}
      </div>
      {open.isError && (
        <p className="isl-err" role="alert">
          {open.error.message}
        </p>
      )}
    </section>
  );
}
