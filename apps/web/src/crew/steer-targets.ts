import {
  STEER_ALL,
  STEER_AUTO,
  STEER_COORDINATOR,
  type Orchestration,
  type PieceList,
} from '@spark-outpost/contracts';
import type { PickerChoice } from '../ui/ChoicePicker.tsx';

const OPEN = new Set(['pending', 'ready', 'running']);

export function steerablePieces(orchestration: Orchestration | null): PieceList | null {
  const list = orchestration?.pieces;
  if (!orchestration?.taskId || !list) return null;
  if (!['running', 'awaiting_approval'].includes(orchestration.status)) return null;
  return list.pieces.some((piece) => OPEN.has(piece.status) && !piece.research) ? list : null;
}

export function steerChoices(list: PieceList): PickerChoice[] {
  const pieces = list.pieces
    .filter((piece) => OPEN.has(piece.status) && !piece.research)
    .map((piece) => ({
      id: piece.key,
      label: `${piece.key} · ${piece.title}`,
      description: [piece.builderName, piece.status].filter(Boolean).join(' · '),
    }));
  return [
    { id: STEER_AUTO, label: 'Auto', description: 'By the words you type' },
    { id: STEER_ALL, label: 'All pieces', description: 'Every piece still open' },
    ...pieces,
    { id: STEER_COORDINATOR, label: 'Coordinator', description: 'Read at integration' },
  ];
}
