import { CHECKPOINT_OPTION, type InvolvementLevel, type Risk } from '@spark-outpost/contracts';
import type { FlowCheckpoint } from './transitions.ts';

export const RETRY_CONFIRM_BELOW = 0.9;

export function asksForPlan(level: InvolvementLevel, risk: Risk): boolean {
  if (level === 'hands-on') return true;
  if (level === 'balanced') return risk === 'multi-file' || risk === 'destructive';
  if (level === 'hands-off') return risk === 'destructive';
  return false;
}

export function asksForRetry(level: InvolvementLevel, confidence: number | null): boolean {
  if (level === 'hands-on') return true;
  if (level === 'balanced') return confidence === null || confidence < RETRY_CONFIRM_BELOW;
  return false;
}

export function asksToKeep(level: InvolvementLevel, filesChanged: number): boolean {
  if (filesChanged === 0) return false;
  return level === 'hands-on' || level === 'balanced';
}

export interface AutoContinueAsk {
  kind: FlowCheckpoint;
  fromJev: boolean;
  agentAsked: boolean;
}

export function autoContinueOption(ask: AutoContinueAsk): string | null {
  if (!ask.fromJev) return null;
  if (ask.kind === 'clarify') return CHECKPOINT_OPTION.clarifyRules;
  if (ask.kind === 'retry') return CHECKPOINT_OPTION.finish;
  if (ask.kind === 'needs_input' && !ask.agentAsked) return CHECKPOINT_OPTION.clarifyRules;
  return null;
}
