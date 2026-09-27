import type { Gate, InvolvementLevel, Risk } from '@spark-outpost/contracts';

export const ACT_AT = 0.9;
export const ACT_AT_READ_ONLY = 0.75;
export const ACT_AT_DOWNGRADE = 0.8;
export const ACT_AT_FRONTIER = ACT_AT;
export const ASK_AT = 0.5;

export const CLARIFY_BELOW: Record<InvolvementLevel, number | null> = {
  'hands-on': 0.75,
  balanced: 0.6,
  'hands-off': 0.5,
  'full-auto': null,
};

export function optionConfidence(topProbability: number, options: number): number {
  if (options < 2) return 1;
  return Math.min(1, Math.max(0, (options * topProbability - 1) / (options - 1)));
}

function decide(confidence: number, actAt: number, clarifyBelow: number | null) {
  if (confidence >= actAt) return 'act';
  if (confidence < ASK_AT) return 'fallback';
  if (clarifyBelow === null) return 'fallback';
  return confidence < clarifyBelow ? 'ask' : 'act';
}

export interface GateOptions {
  downgrade?: boolean;
  readsOnly?: boolean;
}

function actThreshold(risk: Risk, options: GateOptions): number {
  if (risk === 'read-only') return ACT_AT_READ_ONLY;
  if (!options.downgrade) return ACT_AT;
  if (risk === 'edits' || (options.readsOnly && risk !== 'destructive')) return ACT_AT_DOWNGRADE;
  return ACT_AT;
}

export function gate(
  answer: { confidence: number },
  risk: Risk,
  level: InvolvementLevel,
  options: GateOptions = {},
): Gate {
  const actAt = actThreshold(risk, options);
  const clarifyBelow = CLARIFY_BELOW[level];
  return {
    decision: decide(answer.confidence, actAt, clarifyBelow),
    confidence: answer.confidence,
    risk,
    level,
    actAt,
    askAt: ASK_AT,
    clarifyBelow,
  };
}

export function frontierGate(
  answer: { confidence: number },
  risk: Risk,
  level: InvolvementLevel,
): Gate {
  return {
    decision: answer.confidence >= ACT_AT_FRONTIER ? 'act' : 'fallback',
    confidence: answer.confidence,
    risk,
    level,
    actAt: ACT_AT_FRONTIER,
    askAt: ACT_AT_FRONTIER,
    clarifyBelow: null,
  };
}
