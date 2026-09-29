import { placementLabel, type PieceList, type TaskPiece } from '@spark-outpost/contracts';
import type { Coordination } from './state.ts';

export interface ReportFacts {
  list: PieceList | null;
  fallback: string | null;
  integrator: string | null;
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
  return piece.research ? 'read-only' : 'none';
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

function unfinished(list: PieceList): string | null {
  const open = list.pieces.filter((piece) => piece.status !== 'landed');
  if (open.length === 0) return null;
  const named = open.map((piece) => {
    const why = piece.note ? `: ${cell(piece.note)}` : '';
    return `${piece.key} · ${cell(piece.title)} (${piece.status}${why})`;
  });
  return `Incomplete: ${named.join('; ')}.`;
}

export function pieceReport(facts: ReportFacts): string | null {
  if (!facts.list) {
    return facts.fallback
      ? `Coordinator: built with one Builder instead (${facts.fallback}).`
      : null;
  }
  const list = facts.list;
  const lines = [
    `Pieces (${list.pieces.length}, ${list.placement === 'in_order' ? 'in order' : list.placement}, list v${list.version}):`,
    '',
    '| Piece | Builder | Placement | Model | Status | Files | Scoped check | Cost |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...list.pieces.map(row),
  ];
  const integration = list.integration
    ? `Integration: ${facts.integrator ?? 'the integrator'} — ${cell(list.integration)}`
    : null;
  return [lines.join('\n'), integration, ownership(list), unfinished(list)]
    .filter(Boolean)
    .join('\n\n');
}

export function coordinationReport(coordination: Coordination | null | undefined): string | null {
  if (!coordination) return null;
  return pieceReport({
    list: coordination.list,
    fallback: coordination.fallback,
    integrator: coordination.integrated ? coordination.integrator : null,
  });
}
