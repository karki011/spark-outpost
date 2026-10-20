import type { ModePosture } from '@spark-outpost/contracts';

export function modeAllows(posture: ModePosture, request: { kind: string }): boolean {
  if (posture === 'full_access' || posture === 'auto') return true;
  return posture === 'edits' && request.kind === 'edit';
}
