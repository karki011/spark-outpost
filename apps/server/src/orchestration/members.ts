import type { AgentRole, RunMode } from '@spark-outpost/contracts';
import { latestPlan, nextArtifactVersion } from '../persistence/artifacts.ts';
import { insertChildRun, markInPlaceMember, mergeRoute } from '../persistence/orchestrations.ts';
import { requestCancel } from '../persistence/runs.ts';
import { gitDiffSince } from '../projects/snapshot.ts';
import { getSnapshot } from '../persistence/run-snapshots.ts';
import type { ProviderOutput } from '../providers/provider.ts';
import { runAgentTurn, type RunControl } from '../workflow/agent-turn.ts';
import { takeSnapshot } from '../workflow/do-run.ts';
import { executeChildRun } from '../workflow/execute-run.ts';
import { runEvents } from '../workflow/run-events.ts';
import {
  architectNotes,
  architectPrompt,
  builderPrompt,
  criticPrompt,
  readFiles,
  scoutPrompt,
  type ChangedFile,
} from './context.ts';
import { plansFirst } from './depth.ts';
import { reviewNet, withBuilderStyle } from './lean.ts';
import { labelFor, nameFor, recordRoute, resolveRoute } from './member-routes.ts';
import { markPlanStep, stepTicker } from './plan-progress.ts';
import { chainsFromReply, stepNotesFromReply, withFilesLines } from './chains.ts';
import { largeFromReply, parallelFromReply } from './parallel.ts';
import type { ParallelVerdicts } from './parallel-choice.ts';
import { decideParallel } from './parallel-jev.ts';
import { reviewFindings, reviewVerdict } from './review.ts';
import type { MemberRoute } from './routing.ts';
import { publish, routeKey, type MemberResult, type Session } from './session.ts';
import { spanOf } from './spans.ts';
import type { Spawn } from './transitions.ts';

export interface ChangeSummary {
  files: ChangedFile[];
  patch: string;
}

export async function changesSoFar(s: Session): Promise<ChangeSummary> {
  const state = await getSnapshot(s.deps.db, s.input.workspaceId, s.lease.runId);
  const snapshot = state?.snapshot;
  if (!snapshot || snapshot.kind !== 'git' || !snapshot.ref) return { files: [], patch: '' };
  const diff = await gitDiffSince(snapshot.root, snapshot.ref).catch(() => null);
  return diff ? { files: diff.stats, patch: diff.patch } : { files: [], patch: '' };
}

export interface Place {
  group?: string;
  key?: string;
  copy?: (name: string) => { branch: string; prepare: (runId: string) => Promise<void> };
  reuse?: { runId: string; branch: string };
}

export interface MemberOptions {
  record?: boolean;
  prompt?: string;
  followUp?: string;
  attempt?: number;
}

function usesInPlace(s: Session, spawn: Spawn, place: Place | null): boolean {
  if (place || s.inPlaceUsed || spawn.reason !== 'first' || spawn.stepIndex !== 0) return false;
  if (spawn.role === 'scout') return true;
  return spawn.role === 'builder' && !plansFirst(s.flow.depth);
}

function modeFor(s: Session, role: AgentRole): RunMode {
  if (s.input.projectRoots.length === 0) return 'chat';
  return role === 'builder' ? 'do' : 'ask';
}

const PLAN_LINE = /^\s*(?:\d+[.)]|[-*])\s+(.+\S)\s*$/;
const HINT_ITEM =
  /^(?:step\s*\d+\b.*\b(?:files?|depends)\b|chain\s+[\w-]+[^:]*:|large\s*:|parallel\s*:|notes for builders)/i;

export function stepsFromText(text: string): string[] {
  return text
    .split('\n')
    .map((line) => PLAN_LINE.exec(line)?.[1])
    .filter((step): step is string => step !== undefined && !HINT_ITEM.test(step))
    .slice(0, 12);
}

async function promptFor(s: Session, spawn: Spawn): Promise<string> {
  const request = s.input.userRequest;
  if (spawn.role === 'architect') {
    return architectPrompt({
      request,
      history: s.input.history,
      repos: s.input.projectRoots,
      previousPlan: s.plan.map((entry) => entry.content),
      note: spawn.note,
      buildStyle: s.buildStyle,
    });
  }
  const plan = s.flow.steps.filter(Boolean);
  if (spawn.role === 'scout') {
    return scoutPrompt({ request, plan, stepIndex: spawn.stepIndex });
  }
  const changes = await changesSoFar(s);
  if (spawn.role === 'critic') {
    return criticPrompt({
      request,
      plan: s.flow.steps.filter(Boolean),
      changes: changes.files,
      patch: changes.patch,
      checks: [],
      buildStyle: s.buildStyle,
    });
  }
  return builderPrompt({
    request,
    plan: s.flow.steps.filter(Boolean),
    stepIndex: spawn.stepIndex,
    carry: spawn.carry,
    architectNotes: s.architectNotes,
    earlierChanges: changes.files,
    note: spawn.note,
    findings: spawn.reason === 'retry' ? s.findings : [],
    research: s.research,
    ...(spawn.conflict ? { conflict: spawn.conflict } : {}),
    ...(spawn.checkFailures ? { checkFailures: spawn.checkFailures } : {}),
    buildStyle: s.buildStyle,
  });
}

export function resumeKeyFor(s: Session, role: AgentRole, name: string): string | null {
  if (!s.taskId || (role !== 'builder' && role !== 'critic')) return null;
  return `${s.taskId}:${role}:${name}`;
}

interface Counted {
  value: number;
  tools: string[];
}

function counter(s: Session, counted: Counted, also?: (output: ProviderOutput) => void) {
  return (output: ProviderOutput) => {
    also?.(output);
    if (output.kind === 'step_started' && output.tool) {
      counted.value += 1;
      counted.tools.push(output.name);
      s.toolCalls += 1;
    }
  };
}

function memberControl(s: Session): {
  control: Pick<RunControl, 'signal' | 'reason' | 'stop'>;
  abort: () => void;
} {
  const local = new AbortController();
  return {
    abort: () => local.abort(),
    control: {
      signal: AbortSignal.any([s.control.signal, local.signal]),
      reason: () => s.control.reason() ?? (local.signal.aborted ? 'budget' : null),
      stop: (reason) => s.control.stop(reason),
    },
  };
}

type Announce = (runId: string) => Promise<void>;

interface Naming {
  label: string;
  name: string;
}

interface RouteExtra {
  parallelGroup?: string;
  copy?: string;
  resumeKey?: string;
  followUp?: string;
  worktreeRun?: string;
}

function storedRoute(
  route: MemberRoute,
  name: string,
  planStep: string | null,
  extra: RouteExtra = {},
) {
  return {
    name,
    routedBy: route.routedBy,
    autoWouldUse: route.autoWouldUse,
    modelLabel: route.pick.modelLabel,
    planStep,
    ...extra,
  };
}

async function runInPlace(
  s: Session,
  spawn: Spawn,
  route: MemberRoute,
  { label, name }: Naming,
  announce: Announce,
): Promise<MemberResult> {
  s.inPlaceUsed = true;
  const mode = spawn.role === 'scout' && s.input.mode === 'do' ? 'ask' : s.input.mode;
  await markInPlaceMember(s.deps.db, s.lease.runId, {
    role: spawn.role,
    stepIndex: 0,
    attempt: 1,
    agentLabel: label,
    provider: s.input.provider,
    model: route.pick.model,
    effort: route.pick.effort,
    route: storedRoute(route, name, null),
  });
  if (mode !== s.input.mode)
    await s.deps.db.query('UPDATE runs SET mode = $2 WHERE id = $1', [s.lease.runId, mode]);
  const input = {
    ...s.input,
    mode,
    prompt:
      spawn.role === 'builder' ? withBuilderStyle(s.input.prompt, s.buildStyle) : s.input.prompt,
    settings: {
      ...s.input.settings,
      model: route.pick.model,
      modelLabel: route.pick.modelLabel,
      effort: route.pick.effort,
    },
  };
  if (mode === 'do') s.snapshotTaken = true;
  await announce(s.lease.runId);
  const counted: Counted = { value: 0, tools: [] };
  const member = memberControl(s);
  s.members.set(s.lease.runId, member.abort);
  try {
    const result = await runAgentTurn(s.deps, s.lease, input, s.append, member.control, {
      onOutput: counter(s, counted),
    });
    if (result.messageId) s.message = { id: result.messageId, text: result.text };
    return {
      role: spawn.role,
      runId: s.lease.runId,
      stepIndex: 0,
      label,
      outcome: result.outcome,
      error: result.error,
      text: result.text,
      toolCalls: counted.value,
      inPlace: true,
      name,
      steps: [0],
      ticked: [],
      tools: counted.tools,
    };
  } finally {
    s.members.delete(s.lease.runId);
  }
}

export async function ensureParentSnapshot(s: Session): Promise<void> {
  const root = s.input.projectRoots[0];
  if (s.snapshotTaken || !root) return;
  s.snapshotTaken = true;
  await takeSnapshot(s.deps.db, s.lease.runId, root);
}

function routeExtra(
  s: Session,
  spawn: Spawn,
  name: string,
  place: Place | null,
  branch: string | null,
  options: MemberOptions,
): RouteExtra {
  const resumeKey = resumeKeyFor(s, spawn.role, name);
  const followUp = options.followUp ?? spawn.followUp;
  return {
    ...(place?.group ? { parallelGroup: place.group } : {}),
    ...(branch ? { copy: branch } : {}),
    ...(resumeKey ? { resumeKey } : {}),
    ...(followUp ? { followUp } : {}),
    ...(place?.reuse ? { worktreeRun: place.reuse.runId } : {}),
  };
}

async function runChild(
  s: Session,
  spawn: Spawn,
  route: MemberRoute,
  { label, name }: Naming,
  announce: Announce,
  place: Place | null,
  options: MemberOptions,
): Promise<MemberResult> {
  const mode = modeFor(s, spawn.role);
  const copy = place?.reuse ? null : (place?.copy?.(name) ?? null);
  const branch = place?.reuse?.branch ?? copy?.branch ?? null;
  const stepText = spanOf(spawn)
    .map((index) => s.flow.steps[index] ?? '')
    .filter(Boolean)
    .join('\n');
  const planStep = spawn.role === 'builder' || place ? stepText || null : null;
  if (mode === 'do') await ensureParentSnapshot(s);
  const attempt =
    options.attempt ??
    [...s.results].filter((r) => r.role === spawn.role && r.stepIndex === spawn.stepIndex).length +
      1;
  const lease = await insertChildRun(
    s.deps.db,
    {
      parentRunId: s.lease.runId,
      role: spawn.role,
      stepIndex: spawn.stepIndex,
      attempt,
      agentLabel: label,
      provider: route.pick.provider,
      model: route.pick.model,
      effort: route.pick.effort,
      mode,
      prompt: options.prompt ?? (await promptFor(s, spawn)),
      route: storedRoute(route, name, planStep, routeExtra(s, spawn, name, place, branch, options)),
    },
    s.deps.leaseSeconds,
  );
  const cancel = () => void requestCancel(s.deps.db, lease.runId).catch(() => undefined);
  s.members.set(lease.runId, cancel);
  s.control.signal.addEventListener('abort', cancel, { once: true });
  if (copy) await copy.prepare(lease.runId);
  await announce(lease.runId);
  const counted: Counted = { value: 0, tools: [] };
  const steps = spanOf(spawn);
  const ticker = stepTicker(s, spawn.role === 'builder' ? steps : [], lease.runId);
  try {
    const result = await executeChildRun(
      s.deps,
      lease,
      { onOutput: counter(s, counted, ticker.observe), backupAlsoFor: s.lease.runId },
      s.append,
    );
    await ticker.settled();
    return {
      role: spawn.role,
      runId: lease.runId,
      stepIndex: spawn.stepIndex,
      label,
      outcome: result.outcome,
      error: result.error,
      text: result.text,
      toolCalls: counted.value,
      inPlace: false,
      name,
      steps,
      ticked: [...ticker.ticked],
      tools: counted.tools,
      ...(place?.reuse ? { copyRunId: place.reuse.runId } : {}),
    };
  } finally {
    s.control.signal.removeEventListener('abort', cancel);
    s.members.delete(lease.runId);
  }
}

function textPlan(s: Session, text: string): string[] {
  const steps = stepsFromText(text);
  s.plan = steps.map((content) => ({ content, priority: 'medium', status: 'pending' }));
  s.planVersion = null;
  return steps;
}

async function afterArchitect(s: Session, result: MemberResult): Promise<string[]> {
  const plan = s.taskId ? await latestPlan(s.deps.db, s.taskId) : null;
  const architects = new Set(
    s.results.filter((done) => done.role === 'architect').map((done) => done.runId),
  );
  if (!plan || plan.entries.length === 0 || !architects.has(plan.sourceRunId ?? '')) {
    return textPlan(s, result.text);
  }
  s.plan = [...plan.entries];
  s.planVersion = plan.version;
  return plan.entries.map((entry) => entry.content);
}

export interface ReviewOutcome {
  verdict: ReturnType<typeof reviewVerdict>;
  findings: string[];
}

async function afterCritic(
  s: Session,
  result: MemberResult,
  route: MemberRoute,
): Promise<ReviewOutcome> {
  const verdict = result.outcome === 'succeeded' ? reviewVerdict(result.text) : 'unclear';
  const findings = reviewFindings(result.text);
  await mergeRoute(s.deps.db, result.runId, { verdict });
  if (s.taskId) {
    const body = {
      reviewer: route.pick,
      verdict,
      findings,
      text: result.text.slice(0, 64_000),
      label: 'AI review' as const,
      ...(s.buildStyle === 'off' ? {} : { net: reviewNet(result.text) }),
    };
    const version = await nextArtifactVersion(s.deps.db, s.taskId, 'review');
    await s.append(runEvents.activity('artifact:review', 'review', { version, body }), {
      artifact: {
        taskId: s.taskId,
        kind: 'review',
        body,
        version,
        overwrite: false,
        supersedesPrevious: false,
      },
    });
  }
  return { verdict, findings };
}

export interface MemberOutcome {
  result: MemberResult;
  steps?: string[];
  groups?: number[][];
  large?: number[];
  lanes?: number[][];
  parallel?: ParallelVerdicts;
  verdict?: ReturnType<typeof reviewVerdict>;
  review?: ReviewOutcome;
}

async function afterPlan(s: Session, result: MemberResult): Promise<MemberOutcome> {
  const planned = await afterArchitect(s, result);
  const notes = stepNotesFromReply(result.text, planned.length);
  const steps = withFilesLines(planned, notes);
  s.architectNotes = architectNotes(result.text, readFiles(result.tools));
  const groups = parallelFromReply(result.text, steps.length);
  const large = largeFromReply(result.text, steps.length);
  const chains = { chains: chainsFromReply(result.text, steps.length), depends: notes.depends };
  const decision = await decideParallel(s, steps, groups, large, chains, result.runId);
  return {
    result,
    steps,
    groups,
    large,
    lanes: decision.lanes,
    ...(decision.verdicts ? { parallel: decision.verdicts } : {}),
  };
}

export async function runMember(
  s: Session,
  spawn: Spawn,
  place: Place | null = null,
  options: MemberOptions = {},
): Promise<MemberOutcome> {
  const resolved = await resolveRoute(s, spawn);
  const { route } = resolved;
  for (const stepIndex of spanOf(spawn)) s.routes.set(routeKey(spawn.role, stepIndex), route);
  const name = await nameFor(s, spawn.role, place?.key ?? routeKey(spawn.role, spawn.stepIndex));
  const naming = { label: labelFor(spawn.role, route.pick, name), name };
  const announce: Announce = async (runId) => {
    await recordRoute(s, spawn, resolved, runId, name);
    if (spawn.role === 'builder' && !place) {
      await markPlanStep(s, spawn.stepIndex, 'in_progress', runId);
    }
    await publish(s);
  };
  const result = usesInPlace(s, spawn, place)
    ? await runInPlace(s, spawn, route, naming, announce)
    : await runChild(s, spawn, route, naming, announce, place, options);
  if (options.record !== false) s.results.push(result);
  if (result.outcome === 'lease_lost') return { result };
  if (spawn.role === 'builder' && result.outcome !== 'succeeded') {
    const open = result.steps.find((index) => !result.ticked.includes(index)) ?? spawn.stepIndex;
    await markPlanStep(s, open, 'failed', result.runId);
  }
  if (spawn.role === 'scout' && place && result.outcome === 'succeeded') {
    s.research.push({ name, step: s.flow.steps[spawn.stepIndex] ?? '', text: result.text });
  }
  if (spawn.role === 'architect' && result.outcome === 'succeeded') return afterPlan(s, result);
  if (spawn.role === 'critic') {
    const review = await afterCritic(s, result, route);
    if (options.record !== false) s.findings = review.verdict === 'concerns' ? review.findings : [];
    return { result, verdict: review.verdict, review };
  }
  return { result };
}
