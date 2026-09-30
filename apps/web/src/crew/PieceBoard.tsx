import './piece-board.css';
import './piece-state.css';
import {
  pieceBoard,
  type CrewMember,
  type ListPlacement,
  type PieceBoardRow,
  type PieceList,
  type PieceTone,
} from '@spark-outpost/contracts';
import { providerName } from '../chat/provider-name.ts';
import type { PieceState } from './tv-coordinator.ts';

const PLACEMENTS: Record<ListPlacement, string> = {
  in_order: 'in order',
  shared: 'in the shared tree',
  worktree: 'in worktrees',
};

const TONE_STATES: Record<PieceTone, PieceState> = {
  waiting: 'waiting',
  running: 'running',
  done: 'landed',
  skipped: 'skipped',
  failed: 'failed',
};

function money(usd: number | null): string | null {
  return usd === null ? null : `$${usd.toFixed(2)}`;
}

function modelText(row: PieceBoardRow, crew: readonly CrewMember[]): string | null {
  const member = crew.findLast((candidate) => candidate.pieceKey === row.key);
  const provider = member?.provider ?? row.provider;
  const model = member ? (member.modelLabel ?? member.model) : row.model;
  const parts = [provider ? providerName(provider) : null, model].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

function PieceRow({ row, crew }: { row: PieceBoardRow; crew: readonly CrewMember[] }) {
  const details = row.folded
    ? [row.builder, row.check, money(row.costUsd)]
    : [row.builder, modelText(row, crew), row.check, row.notes, money(row.costUsd)];
  const shown = details.filter(Boolean);
  return (
    <li className={`piece-row ${row.tone}${row.folded ? ' folded' : ''}`}>
      <span className="piece-key">{row.key}</span>
      <span className="piece-title">{row.title}</span>
      <span className="piece-status piece-state" data-state={TONE_STATES[row.tone]}>
        {row.status}
      </span>
      <span className="piece-details">
        <span className="piece-place">{row.placement}</span>
        {shown.length > 0 && <span>{shown.join(' · ')}</span>}
      </span>
      {row.note && <span className="piece-note">{row.note}</span>}
    </li>
  );
}

interface PieceBoardProps {
  list: PieceList;
  crew?: readonly CrewMember[];
}

export function PieceBoard({ list, crew = [] }: PieceBoardProps) {
  const rows = pieceBoard(list);
  const landed = rows.filter((row) => row.tone === 'done').length;
  return (
    <section className="piece-board" aria-label="Pieces">
      <p className="piece-board-head">
        {rows.length} {rows.length === 1 ? 'piece' : 'pieces'}, {PLACEMENTS[list.placement]} ·{' '}
        {list.status === 'proposed' ? 'waiting for your go-ahead' : `${landed} landed`}
      </p>
      <ol className="piece-rows">
        {rows.map((row) => (
          <PieceRow key={row.key} row={row} crew={crew} />
        ))}
      </ol>
    </section>
  );
}
