import {
  ORCHESTRATION_ACTIVE_LIMIT_MS,
  ORCHESTRATION_ACTIVITY,
  ORCHESTRATION_TOOL_CALL_LIMIT,
  type AgentRole,
  type BudgetLimit,
  type BuildStyle,
  type CheckBody,
  type PlanEntry,
} from '@spark-outpost/contracts';
import type { IntakeResult } from '../advisor/intake-recorder.ts';
import type { ProjectChecks } from '../checks/project-checks.ts';
import type { Lease } from '../persistence/jobs.ts';
import {
  loadOrchestration,
  updateOrchestration,
  type OrchestrationPatch,
} from '../persistence/orchestrations.ts';
import type { Append, RunControl } from '../workflow/agent-turn.ts';
import type { ExecuteRunDeps } from '../workflow/execute-run.ts';
import { runEvents } from '../workflow/run-events.ts';
import type { RunInput } from '../workflow/run-input.ts';
import type { BudgetLimits } from './budget.ts';
import type { ArchitectNotes, ResearchNote } from './context.ts';
import type { JevAccess } from './jev-calls.ts';
import type { ReviewQueue } from './reviews.ts';
import type { JevPick, MemberRoute, RouteContext } from './routing.ts';
import type { Slots } from './slots.ts';
import type { LaneOptions, LanePlacement } from './placement.ts';
import type { FlowState } from './transitions.ts';

export interface OrchestratorDeps extends ExecuteRunDeps {
  budget?: Partial<BudgetLimits>;
  budgetPollMs?: number;
  checkpointTimeoutMs?: number;
  jevTimeoutMs?: number;
  parallelLimit?: number;
  agentSlots?: Slots;
  lanes?: LaneOptions;
}

export interface MemberResult {
  role: AgentRole;
  runId: string;
  stepIndex: number;
  label: string;
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'lease_lost';
  error: string | null;
  text: string;
  toolCalls: number;
  inPlace: boolean;
  name: string;
  steps: number[];
  ticked: number[];
  tools: string[];
  copyRunId?: string;
}

export interface Session {
  deps: OrchestratorDeps;
  lease: Lease;
  input: RunInput;
  append: Append;
  control: RunControl;
  jev: JevAccess | null;
  route: RouteContext;
  intake: IntakeResult;
  flow: FlowState;
  routes: Map<string, MemberRoute>;
  planned: Map<string, JevPick | null>;
  plannedCalled: boolean;
  plan: PlanEntry[];
  planVersion: number | null;
  taskId: string | null;
  inPlaceUsed: boolean;
  snapshotTaken: boolean;
  message: { id: string; text: string } | null;
  results: MemberResult[];
  findings: string[];
  toolCalls: number;
  limits: BudgetLimits;
  baseLimits: BudgetLimits;
  startedAt: number;
  budgetHit: BudgetLimit | null;
  members: Map<string, () => void>;
  checkpoints: number;
  names: Map<string, string>;
  research: ResearchNote[];
  architectNotes: ArchitectNotes | null;
  slots: Slots;
  groups: number;
  parallelNoted: boolean;
  git: boolean;
  checks: ProjectChecks | null;
  checkRounds: number;
  checkBodies: CheckBody[];
  reviews: ReviewQueue | null;
  projectStyle: BuildStyle;
  buildStyle: BuildStyle;
  buildStyleDecided: boolean;
  lanePlacement: LanePlacement | null;
}

export function baseLimits(deps: OrchestratorDeps): BudgetLimits {
  return {
    activeLimitMs: deps.budget?.activeLimitMs ?? ORCHESTRATION_ACTIVE_LIMIT_MS,
    toolCallLimit: deps.budget?.toolCallLimit ?? ORCHESTRATION_TOOL_CALL_LIMIT,
    costCapUsd: deps.budget?.costCapUsd ?? null,
  };
}

export const routeKey = (role: AgentRole, stepIndex: number) => `${role}:${stepIndex}`;

export async function save(s: Session, patch: OrchestrationPatch = {}): Promise<void> {
  await updateOrchestration(s.deps.db, s.lease.runId, {
    phase: s.flow.phase,
    depth: s.flow.depth,
    retries: s.flow.retries,
    toolCalls: s.toolCalls,
    ...patch,
  });
}

export async function publish(s: Session, patch: OrchestrationPatch = {}): Promise<void> {
  await save(s, patch);
  const view = await loadOrchestration(s.deps.db, s.lease.runId);
  if (!view) return;
  await s.append(runEvents.activity(ORCHESTRATION_ACTIVITY, ORCHESTRATION_ACTIVITY, view));
}
