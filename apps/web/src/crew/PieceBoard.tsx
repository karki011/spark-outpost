import './piece-board.css';
import {
  pieceBoard,
  type ListPlacement,
  type PieceBoardRow,
  type PieceList,
} from '@spark-outpost/contracts';

const PLACEMENTS: Record<ListPlacement, string> = {
  in_order: 'in order',
  shared: 'in the shared tree',
  worktree: 'in worktrees',
};

function money(usd: number | null): string | null {
  return usd === null ? null : `$${usd.toFixed(2)}`;
}

function PieceRow({ row }: { row: PieceBoardRow }) {
  const details = [row.builder, row.placement, row.check, row.notes, money(row.costUsd)].filter(
    Boolean,
  );
  return (
    <li className={`piece-row ${row.tone}${row.folded ? ' folded' : ''}`}>
      <span className="piece-key">{row.key}</span>
      <span className="piece-title">{row.title}</span>
      <span className={`piece-status ${row.tone}`}>{row.status}</span>
      {!row.folded && details.length > 0 && (
        <span className="piece-details">{details.join(' · ')}</span>
      )}
    </li>
  );
}

export function PieceBoard({ list }: { list: PieceList }) {
  const rows = pieceBoard(list);
  const landed = rows.filter((row) => row.tone === 'done').length;
  return (
    <section className="piece-board" aria-label="Pieces">
      <p className="piece-board-head">
        {rows.length} {rows.length === 1 ? 'piece' : 'pieces'}, {PLACEMENTS[list.placement]} ·{' '}
        {landed} landed
      </p>
      <ol className="piece-rows">
        {rows.map((row) => (
          <PieceRow key={row.key} row={row} />
        ))}
      </ol>
    </section>
  );
}
