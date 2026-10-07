import type { PieceList, TaskPiece } from '@spark-outpost/contracts';
import { PATCH_LIMIT, type PieceReview } from '../orchestration/context.ts';
import { patchByFile } from '../orchestration/critic-diff.ts';

function contractText(piece: TaskPiece): string {
  const parts = [
    `Goal: ${piece.goal}`,
    ...(piece.contract ? [`Contract: ${piece.contract}`] : []),
    ...(piece.acceptance.length > 0
      ? [`Acceptance:\n${piece.acceptance.map((item) => `- ${item}`).join('\n')}`]
      : []),
  ];
  return parts.join('\n');
}

export function pieceReviews(
  list: PieceList | null | undefined,
  patch: string,
): PieceReview[] | null {
  if (!list || patch.length <= PATCH_LIMIT) return null;
  const files = patchByFile(patch);
  const claimed = new Set<string>();
  const reviews: PieceReview[] = [];
  for (const piece of list.pieces) {
    if (piece.status !== 'landed' || piece.research) continue;
    const own = piece.filesChanged.filter((file) => files.has(file) && !claimed.has(file));
    if (own.length === 0) continue;
    for (const file of own) claimed.add(file);
    const builder = piece.builderName ? ` (${piece.builderName})` : '';
    reviews.push({
      heading: `${piece.key} · ${piece.title}${builder}`,
      contract: contractText(piece),
      patch: own.map((file) => files.get(file)!).join('\n'),
    });
  }
  const rest = [...files.keys()].filter((file) => !claimed.has(file));
  if (rest.length > 0) {
    reviews.push({
      heading: 'Integration and other files',
      contract: 'Glue between the pieces and fixes after the full checks.',
      patch: rest.map((file) => files.get(file)!).join('\n'),
    });
  }
  return reviews.length > 1 ? reviews : null;
}
