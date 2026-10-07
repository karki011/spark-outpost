import { PIECE_LIMITS } from '@spark-outpost/contracts';

interface TrimmedBlock {
  block: unknown;
  trimmed: string[];
}

const ELLIPSIS = '…';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function clipProse(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  const room = limit - ELLIPSIS.length;
  const head = trimmed.slice(0, room);
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace > room * 0.6 ? head.slice(0, lastSpace) : head;
  return `${cut.trimEnd()}${ELLIPSIS}`;
}

function clipField(
  owner: Record<string, unknown>,
  field: string,
  limit: number,
  label: string,
  trimmed: string[],
): void {
  const value = owner[field];
  if (typeof value !== 'string' || value.trim().length <= limit) return;
  trimmed.push(`${label} cut from ${value.trim().length} to ${limit} characters`);
  owner[field] = clipProse(value, limit);
}

function clipAcceptance(piece: Record<string, unknown>, label: string, trimmed: string[]): void {
  const items = piece.acceptance;
  if (!Array.isArray(items)) return;
  piece.acceptance = items.map((item: unknown, index) => {
    if (typeof item !== 'string' || item.trim().length <= PIECE_LIMITS.item) return item;
    trimmed.push(
      `${label} acceptance ${index + 1} cut from ${item.trim().length} to ${PIECE_LIMITS.item} characters`,
    );
    return clipProse(item, PIECE_LIMITS.item);
  });
}

export function trimPiecesBlock(block: unknown): TrimmedBlock {
  if (!isRecord(block) || !Array.isArray(block.pieces)) return { block, trimmed: [] };
  const trimmed: string[] = [];
  const pieces = block.pieces.map((raw: unknown, index) => {
    if (!isRecord(raw)) return raw;
    const piece = { ...raw };
    const label = typeof piece.key === 'string' ? piece.key : `piece ${index + 1}`;
    clipField(piece, 'title', PIECE_LIMITS.title, `${label} title`, trimmed);
    clipField(piece, 'goal', PIECE_LIMITS.goal, `${label} goal`, trimmed);
    clipField(piece, 'contract', PIECE_LIMITS.contract, `${label} contract`, trimmed);
    clipAcceptance(piece, label, trimmed);
    return piece;
  });
  const next: Record<string, unknown> = { ...block, pieces };
  clipField(next, 'integration', PIECE_LIMITS.integration, 'integration', trimmed);
  return { block: next, trimmed };
}
