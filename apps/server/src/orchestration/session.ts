import {
  ORCHESTRATION_ACTIVITY,
  type AgentRole,
  type BuildStyle,
  type CheckBody,
  type PlanEntry,
} from '@spark-outpost/contracts';
import type { Need } from './simple-intake.ts';
import type { IntakeResult } from '../advisor/intake-recorder.ts';
import type { ScanReport } from '../codescan/scan.ts';
import type { Ranking } from './observe-rank.ts';
import type { GitHubDeps } from '../ship/github/access.ts';
import type { CodeScanner, ScanOutcome } from '../codescan/scanner.ts';
import type { ProjectChecks } from '../checks/project-checks.ts';
import { nextArtifactVersion, type ArtifactWrite } from '../persistence/artifacts.ts';
import type { Lease } from '../persistence/jobs.ts';
import {
  loadOrchestration,
  updateOrchestration,
  waitedMs,
  type OrchestrationPatch,
} from '../persistence/orchestrations.ts';
import type { Append, RunControl } from '../workflow/agent-turn.ts';
import type { ExecuteRunDeps } from '../workflow/execute-run.ts';
import { runEvents } from '../workflow/run-events.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { activeTime } from './active-time.ts';
import type { JevAccess } from './jev-calls.ts';
import type { ProjectStyle } from './lean.ts';
import type { LoopGuardSettings } from './loop-guard.ts';
import type { MemberRoute, RouteContext, RouteFacts } from './routing.ts';
import type { SpawnReason } from './flow-types.ts';
import type { FlowState } from './transitions.ts';
import type { Coordination } from '../coordinator/state.ts';
import type { Slots } from './slots.ts';
import type { LawReview } from '../laws/review.ts';
import type { TaskEstimate } from '../laws/estimate.ts';

export interface OrchestratorDeps extends ExecuteRunDeps {
  activeTimePollMs?: number;
  checkpointTimeoutMs?: number;
  checkTimeoutMs?: number;
  criticQuietNoticeMs?: number;
  jevTimeoutMs?: number;
  loopGuard?: Partial<LoopGuardSettings> | false;
  codeScan?: CodeScanner;
  branchPrefix?: string;
  shipAccess?: ShipAccess;
  coordinator?: CoordinatorMode;
  forcedPlacement?: ForcedPlacement | undefined;
  agentSlots?: Slots;
}

export type CoordinatorMode = 'off' | 'shadow' | 'in_order' | 'parallel';

export type ForcedPlacement = 'shared' | 'worktree';

export type ShipAccess = Omit<GitHubDeps, 'db' | 'workspaceId'>;

export interface Seat {
  role: Extract<AgentRole, 'builder' | 'integrator' | 'coordinator' | 'scout'>;
  name: string;
  resumeKey: string;
  prompt: string | null;
  route?: Record<string, unknown>;
  memberRoute?: MemberRoute;
}

export interface CheckMemory {
  base?: string | null;
  unfinished: Set<string>;
  fixed: Set<string>;
  earlier?: Set<string>;
  fixRounds: Map<string, number>;
}

export interface MemberResult {
  role: AgentRole;
  runId: string;
  label: string;
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'lease_lost';
  error: string | null;
  text: string;
  toolCalls: number;
  inPlace: boolean;
  name: string;
  loop: string | null;
  copyRunId?: string;
  reason?: SpawnReason;
}

export interface Session {
  deps: OrchestratorDeps;
  lease: Lease;
  input: RunInput;
  append: Append;
  control: RunControl;
  jev: JevAccess | null;
  route: RouteContext;
  facts: RouteFacts;
  intake: IntakeResult;
  flow: FlowState;
  routes: Map<AgentRole, MemberRoute>;
  plan: PlanEntry[];
  taskId: string | null;
  continuesTask: boolean;
  message: { id: string; text: string } | null;
  results: MemberResult[];
  findings: string[];
  toolCalls: number;
  startedAt: number;
  members: Map<string, () => void>;
  checkpoints: number;
  git: boolean;
  checks: ProjectChecks | null;
  checkRounds: number;
  checkBodies: CheckBody[];
  checkLines: string[];
  checkMemory?: CheckMemory;
  projectStyle: ProjectStyle;
  buildStyle: BuildStyle;
  assumption: string | null;
  needsCopy: boolean;
  placeLater?: boolean;
  copyRunId: string | null;
  copyMerged?: string;
  snapshotTaken: boolean;
  closeReason: string | null;
  observations: Promise<void>[];
  jevDiffs: boolean;
  scan?: Promise<ScanOutcome> | null;
  scanRoot?: string | null;
  scanReport?: ScanReport | null;
  ranking?: Promise<Ranking | null>;
  unverified?: boolean;
  risky?: string | null;
  shipLine?: string | null;
  prNotes?: string[];
  fixRound?: number | null;
  fixTree?: string | null;
  fixPatch?: string | null;
  reviewNotes?: string[];
  suggestions?: string[];
  integrator?: Seat | null;
  coordination?: Coordination | null;
  handoff?: string | null;
  laws?: LawReview | null;
  criticRemovals?: string[] | null;
  estimate?: TaskEstimate | null;
  need?: Need;
  upgraded?: boolean;
}

export function builderKey(taskId: string): string {
  return `${taskId}:builder`;
}

export function escalatedKey(taskId: string): string {
  return `${taskId}:escalated`;
}

export async function save(s: Session, patch: OrchestrationPatch = {}): Promise<void> {
  await updateOrchestration(s.deps.db, s.lease.runId, {
    phase: s.flow.phase,
    depth: s.flow.depth,
    retries: s.flow.retries,
    toolCalls: s.toolCalls,
    ...patch,
  });
}

export async function saveActiveTime(s: Session): Promise<void> {
  const waited = await waitedMs(s.deps.db, s.lease.runId);
  await save(s, { activeMs: activeTime(Date.now() - s.startedAt, waited) });
}

export async function publish(s: Session, patch: OrchestrationPatch = {}): Promise<void> {
  await save(s, patch);
  const view = await loadOrchestration(s.deps.db, s.lease.runId);
  if (!view) return;
  await s.append(runEvents.activity(ORCHESTRATION_ACTIVITY, ORCHESTRATION_ACTIVITY, view));
}

export async function appendNewArtifact(
  s: Pick<Session, 'deps' | 'append'>,
  taskId: string,
  kind: 'review' | 'check' | 'shortcuts',
  body: ArtifactWrite['body'],
): Promise<void> {
  const version = await nextArtifactVersion(s.deps.db, taskId, kind);
  await s.append(runEvents.activity(`artifact:${kind}`, kind, { version, body }), {
    artifact: { taskId, kind, body, version, overwrite: false, supersedesPrevious: false },
  });
}
