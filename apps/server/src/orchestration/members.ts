import type { AgentRole, RunMode } from '@spark-outpost/contracts';
import { findingKind } from '../advisor/finding-questions.ts';
import { integratorRoute } from '../coordinator/integrator.ts';
import { previousReply } from '../advisor/intake-recorder.ts';
import { plansThisTurn } from '../plans/plan-mode.ts';
import { insertChildRun, markInPlaceMember, mergeRoute } from '../persistence/orchestrations.ts';
import { requestCancel } from '../persistence/runs.ts';
import type { ProviderOutput } from '../providers/provider.ts';
import { runAgentTurn, type RunControl } from '../workflow/agent-turn.ts';
import { takeSnapshot } from '../workflow/do-run.ts';
import { executeChildRun } from '../workflow/execute-run.ts';
import { meterSpend } from './budget-check.ts';
import { blindReview } from './critic-recheck.ts';
import { checkFixFollowUp, fixFollowUp, makeChangeFollowUp } from './context.ts';
import { reviewNet } from './lean.ts';
import { createLoopGuard, DEFAULT_LOOP_GUARD } from './loop-guard.ts';
import {
  labelFor,
  nameFor,
  recordRoute,
  resolveRoute,
  seatRoute,
  type ResolvedRoute,
} from './member-routes.ts';
import { agreedPlanText, promptFor } from './member-prompts.ts';
import { editObserver } from './observe.ts';
import { countOutput, counted } from './reads.ts';
import { reviewFindings, reviewVerdict } from './review.ts';
import type { MemberRoute } from './routing.ts';
import { HANDOFF_KINDS } from './escalation.ts';
import { splitRemovals } from '../laws/critic-text.ts';
import { crewBudget, startBuilderLaws } from '../laws/builder-start.ts';
import { loadHandoff, type HandoffKind } from './handoff.ts';
import {
  appendNewArtifact,
  builderKey,
  escalatedKey,
  fitToolLimit,
  publish,
  type MemberResult,
  type Seat,
  type Session,
} from './session.ts';
import type { Spawn } from './transitions.ts';

export interface Place {
  copy?: (name: string) => { branch: string; prepare: (runId: string) => Promise<void> };
  reuse?: { runId: string; branch: string };
}

export interface MemberOptions {
  checkFailures?: string;
  seat?: Seat;
  resumeKey?: string;
}

export interface MemberOutcome {
  result: MemberResult;
  verdict?: ReturnType<typeof reviewVerdict>;
}

const RESUME_FOLLOW_UP = 'Continue where you stopped, then reply with what you changed.';

function modeFor(s: Session, role: AgentRole): RunMode {
  if (s.input.projectRoots.length === 0) return 'chat';
  return role === 'builder' || role === 'integrator' ? 'do' : 'ask';
}

function counter(s: Session) {
  const total = counted();
  const observe = (output: ProviderOutput) => {
    if (countOutput(total, output)) s.toolCalls += 1;
  };
  return { total, observe };
}

function liveCostOf(s: Session, runId: string): (usd: number, final: boolean) => void {
  return (usd, final) => {
    s.liveCost.set(runId, usd);
    if (!final) meterSpend(s);
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

function escalationOf(route: MemberRoute) {
  const escalation = route.escalation;
  if (!escalation || escalation.kind === 'stay') return {};
  const { kind, to } = escalation;
  return { escalation: { kind, model: to.model, modelLabel: to.modelLabel } };
}

function storedRoute(route: MemberRoute, name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    routedBy: route.routedBy,
    autoWouldUse: route.autoWouldUse,
    modelLabel: route.pick.modelLabel,
    ...(route.note ? { routeNote: route.note } : {}),
    ...escalationOf(route),
    ...extra,
  };
}

function handoffKind(route: MemberRoute): HandoffKind | null {
  const kind = route.escalation?.kind;
  return kind && HANDOFF_KINDS.has(kind) ? (kind as HandoffKind) : null;
}

async function handoffFor(s: Session, role: AgentRole, route: MemberRoute) {
  const kind = role === 'builder' ? handoffKind(route) : null;
  if (!kind) return null;
  s.handoff ??= await loadHandoff(s, kind);
  return s.handoff;
}

function builderSessionKey(taskId: string, route: MemberRoute): string {
  return route.escalation?.kind === 'brief' ? escalatedKey(taskId) : builderKey(taskId);
}

export async function setRunMode(s: Session, mode: RunMode | null): Promise<void> {
  await s.deps.db.query('UPDATE runs SET mode = $2 WHERE id = $1', [s.lease.runId, mode]);
}

async function runInPlace(
  s: Session,
  resolved: ResolvedRoute,
  name: string,
): Promise<MemberResult> {
  const { route } = resolved;
  const mode = s.input.mode === 'do' ? 'ask' : s.input.mode;
  const label = labelFor('scout', route.pick, name);
  await markInPlaceMember(s.deps.db, s.lease.runId, {
    role: 'scout',
    stepIndex: 0,
    attempt: 1,
    agentLabel: label,
    provider: s.input.provider,
    model: route.pick.model,
    effort: route.pick.effort,
    route: storedRoute(route, name),
  });
  if (mode !== s.input.mode) await setRunMode(s, mode);
  const preamble = await agreedPlanText(s);
  const { planning: drafting, ...facts } = s.input;
  const planning = drafting === true || plansThisTurn(facts);
  const input = {
    ...s.input,
    mode,
    planning,
    ...(preamble ? { preamble } : {}),
    settings: {
      ...s.input.settings,
      model: route.pick.model,
      modelLabel: route.pick.modelLabel,
      effort: route.pick.effort,
    },
  };
  await recordRoute(s, 'scout', resolved, s.lease.runId, name);
  await publish(s);
  const { total, observe } = counter(s);
  const member = memberControl(s);
  s.members.set(s.lease.runId, member.abort);
  if (s.budgetHit) member.abort();
  try {
    const result = await runAgentTurn(s.deps, s.lease, input, s.append, member.control, {
      onOutput: observe,
      onLiveCost: liveCostOf(s, s.lease.runId),
    });
    if (result.messageId) s.message = { id: result.messageId, text: result.text };
    return {
      role: 'scout',
      runId: s.lease.runId,
      label,
      outcome: result.outcome,
      error: result.error,
      text: result.text,
      toolCalls: total.value,
      inPlace: true,
      name,
      loop: null,
    };
  } finally {
    s.members.delete(s.lease.runId);
    s.liveCost.delete(s.lease.runId);
  }
}

export async function ensureParentSnapshot(s: Session): Promise<void> {
  const root = s.input.projectRoots[0];
  if (s.snapshotTaken || !root) return;
  s.snapshotTaken = true;
  await takeSnapshot(s.deps.db, s.lease.runId, root);
}

interface Opening {
  route: MemberRoute;
  handoff: string | null;
}

function followUpFor(
  s: Session,
  spawn: Spawn,
  options: MemberOptions,
  opening: Opening,
): string | null {
  if (options.checkFailures) return checkFixFollowUp(options.checkFailures);
  if (spawn.followUp) return spawn.followUp;
  if (spawn.role !== 'builder') return null;
  if (spawn.reason === 'fix') return fixFollowUp(spawn.note);
  if (spawn.reason === 'resume') return RESUME_FOLLOW_UP;
  if (spawn.reason === 'first' && opening.handoff) return opening.handoff;
  if (spawn.reason === 'first' && s.input.startAs === 'change') {
    return makeChangeFollowUp(previousReply(s.input));
  }
  if (spawn.reason === 'first' && s.continuesTask) {
    const handback = opening.route.handback;
    return handback ? `${handback}\n\n${s.input.prompt}` : s.input.prompt;
  }
  return null;
}

function withFollowUp(prompt: string, followUp: string | null, message: string): string {
  return followUp && followUp !== message && followUp !== prompt
    ? `${prompt}\n\n${followUp}`
    : prompt;
}

async function runChild(
  s: Session,
  spawn: Spawn,
  resolved: ResolvedRoute,
  name: string,
  place: Place | null,
  options: MemberOptions,
): Promise<MemberResult> {
  const { route } = resolved;
  const seat = options.seat ?? null;
  const role = seat?.role ?? spawn.role;
  const mode = modeFor(s, role);
  const copy = place?.reuse ? null : (place?.copy?.(name) ?? null);
  const branch = place?.reuse?.branch ?? copy?.branch ?? null;
  const label = labelFor(role, route.pick, name);
  if (mode === 'do') await ensureParentSnapshot(s);
  const handoff = seat ? null : await handoffFor(s, spawn.role, route);
  const followUp = followUpFor(s, spawn, options, { route, handoff });
  const resumeKey =
    seat?.resumeKey ??
    options.resumeKey ??
    (spawn.role === 'builder' && s.taskId ? builderSessionKey(s.taskId, route) : null);
  const attempt = s.results.filter((result) => result.role === spawn.role).length + 1;
  const prompt = seat?.prompt ?? handoff ?? (await promptFor(s, spawn));
  const lease = await insertChildRun(
    s.deps.db,
    {
      parentRunId: s.lease.runId,
      role,
      stepIndex: 0,
      attempt,
      agentLabel: label,
      provider: route.pick.provider,
      model: route.pick.model,
      effort: route.pick.effort,
      mode,
      prompt: withFollowUp(prompt, followUp, s.input.prompt),
      route: storedRoute(route, name, {
        ...seat?.route,
        ...(branch ? { copy: branch } : {}),
        ...(resumeKey ? { resumeKey } : {}),
        ...(followUp ? { followUp } : {}),
        ...(place?.reuse ? { worktreeRun: place.reuse.runId } : {}),
        ...(spawn.role === 'critic' && route.pick.provider === s.input.provider
          ? { sameProvider: true }
          : {}),
      }),
    },
    s.deps.leaseSeconds,
  );
  const stopNow = new AbortController();
  const cancel = () => {
    stopNow.abort();
    void requestCancel(s.deps.db, lease.runId).catch(() => undefined);
  };
  s.members.set(lease.runId, cancel);
  s.control.signal.addEventListener('abort', cancel, { once: true });
  if (s.control.signal.aborted || s.budgetHit) {
    stopNow.abort();
    await requestCancel(s.deps.db, lease.runId);
  }
  if (copy) {
    await copy.prepare(lease.runId);
    s.copyRunId ??= lease.runId;
  }
  fitToolLimit(s, route.pick.provider);
  if (!seat) await startBuilderLaws(s, spawn, route, lease.runId);
  const budget = seat ? null : crewBudget(s, spawn.role);
  if (budget) await mergeRoute(s.deps.db, lease.runId, { budget });
  await recordRoute(s, role, resolved, lease.runId, name);
  await publish(s);
  const settings =
    s.deps.loopGuard === false ? null : { ...DEFAULT_LOOP_GUARD, ...s.deps.loopGuard };
  const guard = createLoopGuard(name, spawn.role === 'builder' ? settings : null, cancel);
  const { total, observe } = counter(s);
  try {
    const result = await executeChildRun(
      s.deps,
      lease,
      {
        onOutput: observe,
        onProduced: guard.observe,
        onLiveCost: liveCostOf(s, lease.runId),
        backupAlsoFor: s.lease.runId,
        stopNow: stopNow.signal,
        recordsPlan: spawn.role === 'builder' && (!seat || seat.role === 'integrator'),
        ...(spawn.role === 'builder' ? { observeEdits: editObserver(s, lease.runId) } : {}),
      },
      s.append,
    );
    return {
      role: spawn.role,
      runId: lease.runId,
      label,
      outcome: result.outcome,
      error: result.error,
      text: result.text,
      toolCalls: total.value,
      inPlace: false,
      name,
      loop: guard.tripped(),
      reason: spawn.reason,
      ...(place?.reuse ? { copyRunId: place.reuse.runId } : {}),
    };
  } finally {
    s.control.signal.removeEventListener('abort', cancel);
    s.members.delete(lease.runId);
    s.liveCost.delete(lease.runId);
    await mergeRoute(s.deps.db, lease.runId, { fileReads: total.reads.length }).catch(
      () => undefined,
    );
  }
}

async function afterCritic(s: Session, result: MemberResult, route: MemberRoute) {
  const verdict = result.outcome === 'succeeded' ? reviewVerdict(result.text) : 'unclear';
  const all = reviewFindings(result.text);
  const { removed, rest: findings } = splitRemovals(all);
  s.criticRemovals = result.outcome === 'succeeded' ? removed : null;
  await mergeRoute(s.deps.db, result.runId, { verdict });
  s.findings = verdict === 'concerns' ? findings : [];
  if (verdict === 'looks_good') {
    s.suggestions = findings.filter((finding) => findingKind(finding) === 'suggestion');
  }
  if (!s.taskId) return verdict;
  const body = {
    reviewer: route.pick,
    verdict,
    findings: all,
    text: result.text.slice(0, 64_000),
    label: 'AI review' as const,
    ...(route.pick.provider === s.input.provider ? { sameProvider: true } : {}),
    ...(s.buildStyle === 'off' ? {} : { net: reviewNet(result.text) }),
  };
  await appendNewArtifact(s, s.taskId, 'review', body);
  return verdict;
}

function seatFor(s: Session, spawn: Spawn, options: MemberOptions): MemberOptions {
  if (options.seat || spawn.role !== 'builder' || !s.integrator) return options;
  if (spawn.escalate || !s.coordination) return { ...options, seat: s.integrator };
  const memberRoute = integratorRoute(s, s.coordination, 'fix');
  return { ...options, seat: { ...s.integrator, memberRoute } };
}

export async function runMember(
  s: Session,
  spawn: Spawn,
  place: Place | null = null,
  options: MemberOptions = {},
): Promise<MemberOutcome> {
  const seated = seatFor(s, spawn, options);
  const own = seated.seat?.memberRoute;
  const resolved = own
    ? { route: own }
    : seated.seat
      ? seatRoute(s, spawn)
      : await resolveRoute(s, spawn);
  if (!own && seated.seat?.role !== 'coordinator') s.routes.set(spawn.role, resolved.route);
  const name = seated.seat?.name ?? (await nameFor(s, spawn.role));
  const childOptions = spawn.role === 'critic' ? { ...seated, resumeKey: criticKey(s) } : seated;
  const result =
    spawn.role === 'scout'
      ? await runInPlace(s, resolved, name)
      : await runChild(s, spawn, resolved, name, place, childOptions);
  s.results.push(result);
  if (result.outcome === 'lease_lost') return { result };
  if (spawn.role !== 'critic') return { result };
  const followUp = await blindReview(s, result);
  if (!followUp) return { result, verdict: await afterCritic(s, result, resolved.route) };
  const recheck = await runChild(s, { ...spawn, followUp }, resolved, name, place, childOptions);
  s.results.push(recheck);
  if (recheck.outcome === 'lease_lost') return { result: recheck };
  const final = recheck.outcome === 'succeeded' ? recheck : result;
  return { result: final, verdict: await afterCritic(s, final, resolved.route) };
}

function criticKey(s: Session): string {
  const reviews = s.results.filter((result) => result.role === 'critic').length;
  return `${s.lease.runId}:critic:${reviews + 1}`;
}
