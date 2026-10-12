import type { CSSProperties } from 'react';
import { TeammateFace } from '../teammates/TeammateFace.tsx';
import { TickIcon } from '../ui/icons.tsx';
import { needsYou, startTiles, type StartId, type StartTile } from './quick-tiles.ts';

interface QuickTilesProps {
  waiting: number;
  project: string | null;
  onNew: () => void;
  onAsk: () => void;
  onChats: () => void;
  onMakeSpark: (() => void) | null;
}

function slot(index: number): CSSProperties {
  return { '--i': index } as CSSProperties;
}

function StartButton({ tile, index, run }: { tile: StartTile; index: number; run: () => void }) {
  return (
    <button
      type="button"
      className="isl-tile"
      style={slot(index)}
      aria-label={tile.sub ? tile.hint : undefined}
      title={tile.hint}
      onClick={run}
    >
      <span className="isl-tile-face" aria-hidden="true">
        <TeammateFace face={tile.face} size={28} />
      </span>
      <span className="isl-tile-text">
        <span className="isl-tile-name">{tile.name}</span>
        {tile.sub && <span className="isl-tile-role">{tile.sub}</span>}
      </span>
    </button>
  );
}

function NeedsYouTile({
  waiting,
  index,
  run,
}: {
  waiting: number;
  index: number;
  run: () => void;
}) {
  const needs = needsYou(waiting);
  if (!needs) {
    return (
      <p className="isl-tile-quiet" style={slot(index)}>
        <TickIcon />
        Nothing needs you
      </p>
    );
  }
  return (
    <button
      type="button"
      className="isl-tile isl-tile-needs"
      style={slot(index)}
      aria-label={needs.label}
      title="Opens the Chats tab"
      onClick={run}
    >
      <span className="isl-tile-face" aria-hidden="true">
        <TeammateFace face={{ shape: 'nub', color: 'gold' }} size={28} state="needs_you" />
      </span>
      <span className="isl-tile-text">
        <span className="isl-tile-name">Needs you</span>
        <span className="isl-tile-role">{needs.sub}</span>
      </span>
      <span className="isl-badge" aria-hidden="true">
        {needs.count}
      </span>
    </button>
  );
}

export function QuickTiles(props: QuickTilesProps) {
  const runs: Record<StartId, () => void> = {
    new: props.onNew,
    ask: props.onAsk,
    make: props.onMakeSpark ?? props.onChats,
    chats: props.onChats,
  };
  const tiles = startTiles(props.project, props.onMakeSpark !== null);
  return (
    <>
      {tiles.map((tile, index) => (
        <StartButton key={tile.id} tile={tile} index={index} run={runs[tile.id]} />
      ))}
      <NeedsYouTile waiting={props.waiting} index={tiles.length} run={props.onChats} />
    </>
  );
}
