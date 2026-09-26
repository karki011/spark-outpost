import type { Depth, GateDecision, JevIntake, Risk, RunMode } from '@spark-outpost/contracts';
import { ASK_AT } from '../advisor/gate.ts';

const DEPTH_FOR_RISK: Record<Risk, Depth> = {
  'read-only': 'execute',
  edits: 'execute',
  'multi-file': 'plan_execute',
  destructive: 'plan_execute_review',
};

export function trustedRisk(mode: RunMode, jev: JevIntake | null): Risk {
  if (mode !== 'do') return 'read-only';
  if (!jev) return 'edits';
  const confidence = jev.confidences.risk ?? 0;
  return confidence >= ASK_AT ? jev.risk : 'edits';
}

export function ruleDepth(mode: RunMode, risk: Risk): Depth {
  if (mode !== 'do') return 'direct';
  return DEPTH_FOR_RISK[risk];
}

export function allowedDepth(mode: RunMode, depth: Depth): Depth {
  return mode === 'do' ? depth : 'direct';
}

export interface DepthChoice {
  depth: Depth;
  source: 'jev' | 'rules';
  reason: string | null;
}

export const PLAN_IN_REQUEST_MAX_FILES = 6;
export const PLAN_IN_REQUEST_CONFIDENCE = 0.7;

export function chooseDepth(
  mode: RunMode,
  risk: Risk,
  jev: JevIntake | null,
  decision: GateDecision | null,
): DepthChoice {
  if (jev && decision === 'act') {
    return { depth: allowedDepth(mode, jev.depth), source: 'jev', reason: null };
  }
  return { depth: ruleDepth(mode, risk), source: 'rules', reason: null };
}

function wantsReview(jev: JevIntake | null): boolean {
  if (jev?.depth !== 'plan_execute_review') return false;
  return (jev.confidences.depth ?? jev.confidence) >= ASK_AT;
}

function planInRequest(risk: Risk, files: number, jev: JevIntake | null): boolean {
  if (risk !== 'multi-file' || files === 0 || files > PLAN_IN_REQUEST_MAX_FILES) return false;
  return jev !== null && jev.confidence >= PLAN_IN_REQUEST_CONFIDENCE;
}

export const ONE_SPOT_CONFIDENCE = 0.7;
export const ONE_SPOT_REASON =
  'Jev places the change in one spot, so one Builder does it without an Architect.';

function oneSpot(risk: Risk, jev: JevIntake | null): boolean {
  if (risk === 'destructive' || jev?.scope !== 'one_spot') return false;
  const sure = Math.min(jev.confidences.scope ?? 0, jev.confidence);
  return sure >= ONE_SPOT_CONFIDENCE;
}

export function refineDepth(
  choice: DepthChoice,
  risk: Risk,
  namedFiles: number,
  jev: JevIntake | null,
): DepthChoice {
  if (choice.depth !== 'plan_execute') return choice;
  if (wantsReview(jev)) {
    return {
      ...choice,
      depth: 'plan_execute_review',
      reason: 'Jev suggested a review, and a review only reads, so the Critic runs.',
    };
  }
  if (oneSpot(risk, jev)) return { ...choice, depth: 'execute', reason: ONE_SPOT_REASON };
  if (!planInRequest(risk, namedFiles, jev)) return choice;
  const files = namedFiles === 1 ? '1 file' : `${namedFiles} files`;
  return {
    ...choice,
    depth: 'execute',
    reason: `The request names its ${files}, so one Builder works from it without an Architect.`,
  };
}

export function plansFirst(depth: Depth): boolean {
  return depth === 'plan_execute' || depth === 'plan_execute_review';
}

export function reviewsAfter(depth: Depth): boolean {
  return depth === 'plan_execute_review';
}

export interface ReviewShape {
  depth: Depth;
  reviewIntent: boolean;
}

export function reviewWanted(state: ReviewShape): boolean {
  return reviewsAfter(state.depth) || (state.reviewIntent && state.depth !== 'direct');
}

export const REVIEW_INTENT_CONFIDENCE = 0.5;
export const REVIEW_INTENT_REASON =
  'Jev reads the request as a review, so a Critic reviews each change as it lands.';

export function reviewIntent(mode: RunMode, jev: JevIntake | null): boolean {
  if (mode !== 'do' || jev?.intent !== 'review') return false;
  return (jev.confidences.intent ?? jev.confidence) >= REVIEW_INTENT_CONFIDENCE;
}

export function intakeDepthNote(depth: DepthChoice, review: boolean): string | null {
  const extra = review && !reviewWanted({ depth: depth.depth, reviewIntent: false });
  const wanted = extra && reviewWanted({ depth: depth.depth, reviewIntent: true });
  const parts = [depth.reason, wanted ? REVIEW_INTENT_REASON : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}
