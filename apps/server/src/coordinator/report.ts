import { placementLabel, type PieceList, type TaskPiece } from '@spark-outpost/contracts';
import { noCheckLabel } from './scoped-checks.ts';
import type { Conflict, Coordination, Renumbered } from './state.ts';

export interface ReportFacts {
  list: PieceList | null;
  fallback: string | null;
  integrator: string | null;
  renumbered?: readonly Renumbered[];
  conflicts?: readonly Conflict[];
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function money(usd: number | null): string {
  return usd === null ? '—' : `$${usd.toFixed(2)}`;
}

function checkCell(piece: TaskPiece): string {
  if (piece.check === 'passed') return 'passed';
  if (piece.check === 'failed') return `failed after ${piece.fixTurns} fix turns`;
  if (piece.research) return 'read-only';
  return noCheckLabel(piece.owns);
}

function row(piece: TaskPiece): string {
  const model = [piece.provider, piece.model].filter(Boolean).join(' · ') || '—';
  return `| ${[
    `${piece.key} · ${cell(piece.title)}`,
    piece.builderName ?? '—',
    placementLabel(piece),
    model,
    piece.status,
    String(piece.filesChanged.length),
    checkCell(piece),
    money(piece.costUsd),
  ].join(' | ')} |`;
}

function violationLine(piece: TaskPiece): string[] {
  return piece.violations.map((violation) => {
    const owner = violation.owner ? `, ${violation.owner} owns it` : '';
    return `\`${violation.path}\` ${violation.action} (${piece.key}${owner})`;
  });
}

function ownership(list: PieceList): string | null {
  const lines = list.pieces.flatMap(violationLine);
  return lines.length > 0 ? `Changes outside a piece: ${lines.join('; ')}.` : null;
}

function named(pieces: readonly TaskPiece[], withStatus: boolean): string {
  return pieces
    .map((piece) => {
      const why = piece.note ? `: ${cell(piece.note)}` : '';
      const status = withStatus ? `${piece.status}${why}` : piece.note ? cell(piece.note) : '';
      return `${piece.key} · ${cell(piece.title)}${status ? ` (${status})` : ''}`;
    })
    .join('; ');
}

function unfinished(list: PieceList): string | null {
  const open = list.pieces.filter(
    (piece) => piece.status !== 'landed' && piece.status !== 'skipped',
  );
  return open.length > 0 ? `Incomplete: ${named(open, true)}.` : null;
}

function skipped(list: PieceList): string | null {
  const dropped = list.pieces.filter((piece) => piece.status === 'skipped');
  return dropped.length > 0 ? `Skipped: ${named(dropped, false)}.` : null;
}

function landedNotes(list: PieceList): string | null {
  const noted = list.pieces.filter((piece) => piece.status === 'landed' && piece.note);
  if (noted.length === 0) return null;
  return `Notes: ${noted.map((piece) => `${piece.key}: ${cell(piece.note!)}`).join('; ')}.`;
}

const PLACED: Record<PieceList['placement'], string> = {
  in_order: 'in order',
  shared: 'in the shared tree',
  worktree: 'in worktrees',
};

function renumberedLine(renumbered: readonly Renumbered[]): string | null {
  if (renumbered.length === 0) return null;
  const named = renumbered.map((item) => `\`${item.from}\` → \`${item.to}\` (${item.piece})`);
  return `Renumbered migrations: ${named.join('; ')}.`;
}

const RESOLVED_BY: Record<NonNullable<Conflict['resolvedBy']>, string> = {
  integrator: 'resolved by the integrator',
  you: 'settled by you',
};

function conflictsLine(conflicts: readonly Conflict[]): string | null {
  if (conflicts.length === 0) return null;
  const named = conflicts.map((conflict) => {
    const how = conflict.resolvedBy ? RESOLVED_BY[conflict.resolvedBy] : 'not resolved';
    return `${conflict.piece} (${conflict.files.map((file) => `\`${file}\``).join(', ')}) ${how}`;
  });
  return `Merge conflicts: ${named.join('; ')}.`;
}

export function pieceReport(facts: ReportFacts): string | null {
  if (!facts.list) {
    return facts.fallback
      ? `Coordinator: built with one Builder instead (${facts.fallback}).`
      : null;
  }
  const list = facts.list;
  const lines = [
    `Pieces (${list.pieces.length}, ${PLACED[list.placement]}, list v${list.version}):`,
    '',
    '| Piece | Builder | Placement | Model | Status | Files | Scoped check | Cost |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...list.pieces.map(row),
  ];
  const integration = list.integration
    ? `Integration: ${facts.integrator ?? 'the integrator'} — ${cell(list.integration)}`
    : null;
  return [
    lines.join('\n'),
    integration,
    conflictsLine(facts.conflicts ?? []),
    renumberedLine(facts.renumbered ?? []),
    ownership(list),
    landedNotes(list),
    skipped(list),
    unfinished(list),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function coordinationReport(coordination: Coordination | null | undefined): string | null {
  if (!coordination) return null;
  return pieceReport({
    list: coordination.list,
    fallback: coordination.fallback,
    integrator: coordination.integrated ? coordination.integrator : null,
    renumbered: coordination.renumbered ?? [],
    conflicts: coordination.conflicts ?? [],
  });
}
