import type { Gate, InvolvementLevel, Risk } from '@spark-outpost/contracts';
import { ACT_AT, ASK_AT, type ActingQuestion, type ObservedQuestion } from './policy.ts';

export { ASK_AT };

const ASKING_LEVELS: ReadonlySet<InvolvementLevel> = new Set(['balanced']);

export function asksWhenUnsure(level: InvolvementLevel): boolean {
  return ASKING_LEVELS.has(level);
}

export function optionConfidence(topProbability: number, options: number): number {
  if (options < 2) return 1;
  return Math.min(1, Math.max(0, (options * topProbability - 1) / (options - 1)));
}

export function noulConfidence(noul: number): number {
  return optionConfidence(Math.max(noul, 1 - noul), 2);
}

export function gate(
  confidence: number,
  question: ActingQuestion | ObservedQuestion,
  level: InvolvementLevel,
  risk: Risk,
): Gate {
  const actAt = ACT_AT[question];
  const asks = asksWhenUnsure(level);
  const decision = confidence >= actAt ? 'act' : asks && confidence >= ASK_AT ? 'ask' : 'fallback';
  return {
    decision,
    confidence,
    risk,
    level,
    actAt,
    askAt: ASK_AT,
    clarifyBelow: asks ? actAt : null,
  };
}

export interface NoulCall {
  value: boolean | null;
  gate: Gate | null;
}

export function noulGate(
  noul: number | null | undefined,
  question: ActingQuestion,
  level: InvolvementLevel,
  risk: Risk,
): NoulCall {
  if (noul === null || noul === undefined || !Number.isFinite(noul)) {
    return { value: null, gate: null };
  }
  const actAt = noulConfidence(ACT_AT[question]);
  const confidence = noulConfidence(noul);
  const asks = asksWhenUnsure(level);
  const decision = confidence >= actAt ? 'act' : asks ? 'ask' : 'fallback';
  return {
    value: decision === 'act' ? noul >= 0.5 : null,
    gate: { decision, confidence, risk, level, actAt, askAt: 0, clarifyBelow: asks ? actAt : null },
  };
}
