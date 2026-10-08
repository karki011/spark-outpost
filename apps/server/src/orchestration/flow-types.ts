import type {
  AgentRole,
  CheckpointKind,
  Depth,
  InvolvementLevel,
  OrchestrationPhase,
  ReviewVerdict,
  Risk,
} from '@spark-outpost/contracts';
import type { Verdict } from '../advisor/verify-questions.ts';
import { IDLE_REVIEW, type ReviewLoop } from './review-loop.ts';

export type SpawnReason =
  'first' | 'retry' | 'fix' | 'continue' | 'escalate' | 'recheck' | 'publish';

export interface CascadeEvidence {
  checksPass: boolean;
  criticConcerns: boolean;
  confidentUnmet: boolean;
}

export interface Spawn {
  role: AgentRole;
  reason: SpawnReason;
  escalate: boolean;
  note: string | null;
  followUp?: string;
}

export type FlowAction =
  | { type: 'ask'; reason: string }
  | ({ type: 'spawn' } & Spawn)
  | { type: 'ask_agent' }
  | { type: 'verify' }
  | { type: 'wrap_up' }
  | { type: 'keep'; note?: string }
  | { type: 'ship'; keptNote?: string }
  | { type: 'revert' }
  | {
      type: 'finish';
      status: 'succeeded' | 'failed' | 'cancelled';
      reason: string | null;
      incomplete?: string;
    };

export type AgentOutcome = 'succeeded' | 'failed' | 'cancelled';

export type StartMode = 'answer' | 'build' | 'ask_agent' | 'plan_first' | 'plan' | 'review';

export type FlowStart = Exclude<StartMode, 'plan' | 'plan_first'>;

export type FlowEvent =
  | { type: 'start'; start: FlowStart }
  | {
      type: 'agent_done';
      role: AgentRole;
      outcome: AgentOutcome;
      error?: string | null;
      open?: readonly string[];
      large?: boolean;
      unchanged?: boolean;
      green?: boolean;
      verdict?: ReviewVerdict;
      fixable?: readonly string[];
      checksFailing?: boolean;
    }
  | {
      type: 'verified';
      accepted: Verdict | null;
      reasons: readonly string[];
      evidence?: CascadeEvidence;
    }
  | { type: 'looped'; summary: string; open?: readonly string[] }
  | { type: 'answered'; optionId: string; note: string | null }
  | {
      type: 'wrapped';
      filesChanged: number;
      checksFailing?: boolean;
      riskyMigration?: string;
      outsideWorktree?: boolean;
    }
  | { type: 'kept' }
  | { type: 'shipped' }
  | { type: 'ship_held'; reason: string }
  | { type: 'reverted' }
  | { type: 'stopped' };

export interface FlowState {
  depth: Depth;
  risk: Risk;
  level: InvolvementLevel;
  phase: OrchestrationPhase;
  reviewWanted: boolean;
  retries: number;
  continues: number;
  reviewed: boolean;
  verdict: ReviewVerdict | null;
  last: Spawn | null;
  waitingFor: CheckpointKind | null;
  open: string[];
  loop: string | null;
  verifier: boolean;
  verdicts: number;
  escalated: boolean;
  large: boolean;
  unchanged?: boolean;
  review: ReviewLoop;
  shipping?: boolean;
  readOnly?: 'review';
  solo?: boolean;
  needsYou?: string;
  unverified?: boolean;
  criticRetried?: boolean;
  criticSkipped?: string | null;
}

export interface FlowResult {
  state: FlowState;
  action: FlowAction;
}

export function initialFlow(
  risk: Risk,
  level: InvolvementLevel,
  reviewWanted = false,
  verifier = false,
): FlowState {
  return {
    depth: 'execute',
    risk,
    level,
    phase: 'intake',
    reviewWanted: reviewWanted || risk === 'destructive',
    retries: 0,
    continues: 0,
    reviewed: false,
    verdict: null,
    last: null,
    waitingFor: null,
    open: [],
    loop: null,
    verifier,
    verdicts: 0,
    escalated: false,
    large: false,
    review: IDLE_REVIEW,
  };
}
