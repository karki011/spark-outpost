import './island-home-tiles.css';
import type { CSSProperties } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TeammateState, TeammateView } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { TeammateFace } from '../teammates/TeammateFace.tsx';
import { teammatesApi } from '../teammates/teammates-api.ts';
import { useTeammates } from '../teammates/use-teammates.ts';
import { PlusIcon } from '../ui/icons.tsx';

export interface SparkTileActions {
  onOpenHere: (chat: { id: string; title: string }) => void;
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

export function SparkTiles(props: SparkTileActions) {
  const { loading, teammates } = useTeammates();
  const queryClient = useQueryClient();
  const open = useMutation({
    mutationFn: teammatesApi.openHome,
    onSuccess: (chat, teammateId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      const name = teammates.find((teammate) => teammate.id === teammateId)?.name ?? 'Spark';
      props.onOpenHere({ id: chat.conversationId, title: name });
    },
  });
  if (loading) return <TileSkeleton />;
  const { onMakeSpark, onEditSpark } = props;
  if (teammates.length === 0 && !onMakeSpark) return null;
  return (
    <section className="isl-hcard isl-tiles" aria-label="Your Sparks" style={tileStyle(1)}>
      <div className="isl-tilegrid">
        {teammates.map((teammate, index) => (
          <SparkTile
            key={teammate.id}
            teammate={teammate}
            index={index}
            opening={open.isPending && open.variables === teammate.id}
            onOpen={() => open.mutate(teammate.id)}
            onEdit={onEditSpark && (() => onEditSpark(teammate.id))}
          />
        ))}
        {onMakeSpark && <NewSparkTile index={teammates.length} onMake={onMakeSpark} />}
      </div>
      {open.isError && (
        <p className="isl-err" role="alert">
          {open.error.message}
        </p>
      )}
    </section>
  );
}
