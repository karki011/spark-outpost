import { placementLabel, type Orchestration } from '@spark-outpost/contracts';

export function pieceLabels(orchestration: Orchestration): Map<string, string> {
  const pieces = new Map((orchestration.pieces?.pieces ?? []).map((piece) => [piece.key, piece]));
  const labels = new Map<string, string>();
  for (const member of orchestration.crew) {
    const piece = member.pieceKey ? pieces.get(member.pieceKey) : undefined;
    if (!piece) continue;
    labels.set(member.runId, `${piece.key} · ${placementLabel(piece)}`);
  }
  return labels;
}
