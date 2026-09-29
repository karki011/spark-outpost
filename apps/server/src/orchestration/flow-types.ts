import type {
  AgentRole,
  BudgetLimit,
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
  'first' | 'retry' | 'fix' | 'continue' | 'resume' | 'unstick' | 'escalate' | 'recheck';

export interface Spawn {
  role: AgentRole;
  reason: SpawnReason;
  escalate: boolean;
  note: string | null;
  followUp?: string;
  auto?: boolean;
}

export type FlowAction =
  | {
      type: 'ask';
      kind: CheckpointKind;
      reason: string;
      interpret?: boolean;
      followUp?: boolean;
      context?: boolean;
    }
  | ({ type: 'spawn' } & Spawn)
  | { type: 'plan'; note: string | null }
  | { type: 'verify' }
  | { type: 'wrap_up' }
  | { type: 'keep'; approvedEach?: boolean }
  | { type: 'ship' }
  | { type: 'revert' }
  | { type: 'restore' }
  | {
      type: 'finish';
      status: 'succeeded' | 'failed' | 'cancelled';
      reason: string | null;
      incomplete?: string;
    };

export type AgentOutcome = 'succeeded' | 'failed' | 'cancelled';

export type StartMode = 'answer' | 'build' | 'interpret' | 'clarify' | 'plan' | 'review';

export type ClarifiedStart = 'answer' | 'plan' | 'build';

export type ReadOnlyWork = 'plan' | 'review';

export type FlowEvent =
  | { type: 'start'; start: StartMode }
  | { type: 'clarified'; start: ClarifiedStart | null }
  | {
      type: 'agent_done';
      role: AgentRole;
      outcome: AgentOutcome;
      error?: string | null;
      open?: readonly string[];
      large?: boolean;
      green?: boolean;
      verdict?: ReviewVerdict;
      fixable?: readonly string[];
      checksFailing?: boolean;
      missingContext?: string | null;
    }
  | { type: 'verified'; accepted: Verdict | null; reasons: readonly string[] }
  | { type: 'looped'; summary: string; open?: readonly string[] }
  | { type: 'answered'; kind: CheckpointKind; optionId: string; note: string | null }
  | {
      type: 'wrapped';
      filesChanged: number;
      checksFailing?: boolean;
      riskyMigration?: string;
      approvedEach?: boolean;
    }
  | { type: 'kept' }
  | { type: 'shipped' }
  | { type: 'ship_held'; reason: string }
  | { type: 'reverted' }
  | { type: 'restored'; restored: boolean }
  | {
      type: 'budget_exceeded';
      limit: BudgetLimit;
      unstarted?: boolean;
      round?: boolean;
      passing?: boolean;
    }
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
  exceeded: BudgetLimit | null;
  resumeLast: boolean;
  open: string[];
  loop: string | null;
  verifier: boolean;
  verdicts: number;
  escalated: boolean;
  large: boolean;
  review: ReviewLoop;
  shipping?: boolean;
  readOnly?: ReadOnlyWork;
  confirmFirst: string | null;
  solo?: boolean;
  missingContext?: string | null;
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
  confirmFirst: string | null = null,
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
    exceeded: null,
    resumeLast: false,
    open: [],
    loop: null,
    verifier,
    verdicts: 0,
    escalated: false,
    large: false,
    review: IDLE_REVIEW,
    confirmFirst,
  };
}
