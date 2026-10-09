import type { MessagePhase } from '../../providers/provider.ts';
import { objectFields } from './object-fields.ts';

const CODEX_PHASES: Record<string, MessagePhase> = {
  commentary: 'commentary',
  final_answer: 'final',
};

export function messagePhase(meta: unknown): { phase?: MessagePhase } {
  const reported = objectFields(objectFields(meta).codex).phase;
  if (typeof reported !== 'string' || !Object.hasOwn(CODEX_PHASES, reported)) return {};
  return { phase: CODEX_PHASES[reported]! };
}
