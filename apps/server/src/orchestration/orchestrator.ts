import { ORCHESTRATION_PARALLEL_LIMIT } from '@spark-outpost/contracts';
import { adviceBody } from '../advisor/advice-body.ts';
import { intakeRequest, recordIntake, type IntakeResult } from '../advisor/intake-recorder.ts';
import { insertAdvice, loadIntakeContext, noteIntakeDepth } from '../persistence/advice.ts';
import { newId } from '../persistence/ids.ts';
import type { Lease } from '../persistence/jobs.ts';
import { insertOrchestration } from '../persistence/orchestrations.ts';
import { recordKeptChanges } from '../outcomes/record.ts';
import { LeaseLostError, appendRunEvent } from '../persistence/run-events.ts';
import { taskForWorkingRun } from '../persistence/tasks.ts';
import { revertRun, runChanges } from '../projects/run-changes.ts';
import { isGitWorkTree } from '../projects/snapshot.ts';
import { startControl, type Append } from '../workflow/agent-turn.ts';
import { APPROVAL_TIMEOUT_MESSAGE } from '../workflow/approval-gate.ts';
import { closeMessage } from '../workflow/execute-run.ts';
import { runEvents } from '../workflow/run-events.ts';
import { loadRunInput, type RunInput } from '../workflow/run-input.ts';
import { exceededLimit } from './budget.ts';
import { CheckpointTimeout } from './checkpoint.ts';
import { ask, assume, budgetUsage, intakeResponse } from './checkpoint-asks.ts';
import { asksToKeep } from './checkpoint-policy.ts';
import { assumptionLine, interpretations, isVagueRequest, vagueHandling } from './clarify.ts';
import { namedFiles } from './context.ts';
import { chooseDepth, intakeDepthNote, refineDepth, reviewIntent, trustedRisk } from './depth.ts';
import { finalText } from './final-message.ts';
import { ORCHESTRATION_JEV_TIMEOUT_MS } from './jev-calls.ts';
import { cleanupCopies, runGroup } from './group.ts';
import { judge } from './judge.ts';
import { buildAndLand } from './land.ts';
import { buildInCopy, buildsInCopy } from './solo-copy.ts';
import { decideBuildStyle, projectBuildStyle, recordShortcuts } from './build-style.ts';
import { collectedReview } from './reviews.ts';
import { sequentialReason } from './parallel.ts';
import { markPlanStep, markPlanSteps, statusAfterJudging } from './plan-progress.ts';
import type { RouteContext } from './routing.ts';
import { Slots } from './slots.ts';
import { baseLimits, publish, save, type OrchestratorDeps, type Session } from './session.ts';
import { closeKeyedSessions, SESSION_CLOSE_REASONS } from '../persistence/provider-sessions.ts';
import { projectChecks } from '../checks/project-checks.ts';
import { initialFlow, nextStep, type FlowAction, type FlowEvent } from './transitions.ts';

function jevTimeout(deps: OrchestratorDeps): number {
  const own = deps.intake?.deps.timeoutMs ?? ORCHESTRATION_JEV_TIMEOUT_MS;
  return Math.min(own, deps.jevTimeoutMs ?? ORCHESTRATION_JEV_TIMEOUT_MS);
}

async function decideIntake(
  deps: OrchestratorDeps,
  input: RunInput,
  append: Append,
): Promise<IntakeResult> {
  if (deps.intake) {
    return recordIntake({ ...deps.intake.deps, timeoutMs: jevTimeout(deps) }, input, append);
  }
  const context = await loadIntakeContext(deps.db, input.workspaceId, input.identity.threadId);
  const body = adviceBody(intakeRequest(input, context), { status: 'not_connected' });
  await insertAdvice(deps.db, input.identity.runId, body);
  return { body, context, outcome: { status: 'not_connected' } };
}

function routeContext(
  input: RunInput,
  intake: IntakeResult,
  risk: RouteContext['risk'],
): RouteContext {
  return {
    routing: intake.context.routing,
    chat: {
      provider: input.provider,
      model: input.settings.model,
      modelLabel: input.settings.modelLabel,
      effort: input.settings.effort,
    },
    candidates: intake.context.candidates,
    risk,
    level: input.level,
  };
}

async function ensureTask(s: Session): Promise<void> {
  if (s.flow.depth === 'direct') return;
  await decideBuildStyle(s);
  if (s.taskId) return;
  const joined = await taskForWorkingRun(s.deps.db, s.lease.runId, s.input.userRequest);
  s.taskId = joined.task.taskId;
  await s.append(runEvents.activity('task', 'task', { taskId: s.taskId, opened: joined.opened }));
}

async function checkBudget(s: Session): Promise<void> {
  if (s.budgetHit || s.members.size === 0) return;
  const usage = await budgetUsage(s);
  await save(s, { activeMs: usage.activeMs });
  const limit = exceededLimit(usage, s.limits);
  if (!limit) return;
  s.budgetHit = limit;
  await save(s, { exceeded: limit });
  for (const abort of s.members.values()) abort();
}

async function perform(s: Session, action: FlowAction): Promise<FlowEvent | null> {
  switch (action.type) {
    case 'ask':
      return ask(s, action);
    case 'spawn': {
      if (action.role !== 'scout') await ensureTask(s);
      if (action.role === 'critic' && s.reviews && s.reviews.size > 0) {
        const collected = await collectedReview(s);
        if (collected) return collected;
      }
      const outcome = buildsInCopy(s, action)
        ? await buildInCopy(s, action)
        : await buildAndLand(s, action);
      const { result, steps, groups, large, lanes, parallel, verdict } = outcome;
      if (result.outcome === 'lease_lost') throw new LeaseLostError(s.lease);
      await publish(s);
      if (result.error === APPROVAL_TIMEOUT_MESSAGE) throw new CheckpointTimeout();
      if (s.budgetHit && s.control.reason() === null)
        return { type: 'budget_exceeded', limit: s.budgetHit, ticked: result.ticked };
      return {
        type: 'agent_done',
        role: action.role,
        outcome: result.outcome,
        error: result.error,
        ...(steps ? { steps } : {}),
        ...(groups && groups.length > 0 ? { groups } : {}),
        ...(large && large.length > 0 ? { large } : {}),
        ...(lanes && lanes.length > 1 ? { lanes } : {}),
        ...(parallel ? { parallel } : {}),
        ...(result.ticked.length > 0 ? { ticked: result.ticked } : {}),
        ...(verdict ? { verdict } : {}),
      };
    }
    case 'spawn_group':
      await ensureTask(s);
      return runGroup(s, action.stepIndexes, action.lanes ?? []);
    case 'judge':
      return judge(s, action.role);
    case 'wrap_up': {
      await recordShortcuts(s).catch(() => null);
      const changes = await runChanges(s.deps.db, s.input.workspaceId, s.lease.runId, true).catch(
        () => null,
      );
      const files = changes?.files.length ?? 0;
      return { type: 'wrapped', filesChanged: files, asksToKeep: asksToKeep(s.flow.level, files) };
    }
    case 'revert':
      await revertRun(s.deps.db, s.input.workspaceId, s.lease.runId, true);
      return { type: 'reverted' };
    case 'finish':
      await finish(s, action.status, action.reason, action.incomplete ?? null);
      return null;
  }
}

async function finish(
  s: Session,
  status: 'succeeded' | 'failed' | 'cancelled',
  reason: string | null,
  incomplete: string | null = null,
) {
  const verdict = s.results.some((result) => result.role === 'critic') ? s.flow.verdict : null;
  const assumed = s.assumption ? assumptionLine(s.assumption) : null;
  const notes = [assumed, incomplete].filter((line): line is string => line !== null);
  const text = withNotes(
    finalText(s.results, verdict, s.findings, s.message !== null, s.checkBodies),
    notes,
    s.message !== null,
  );
  await publish(s, { phase: 'finished', error: status === 'failed' ? reason : null });
  if (text) {
    if (!s.message) {
      s.message = { id: newId(), text: '' };
      await s.append(runEvents.textStart(s.message.id));
    }
    await s.append(runEvents.textContent(s.message.id, text));
    s.message.text += text;
  }
  if (s.message) {
    await closeMessage(s.append, { messageId: s.message.id, text: s.message.text }, true);
  }
  const identity = s.input.identity;
  if (status === 'succeeded') {
    await s.append(runEvents.finished(identity), { transition: { status: 'succeeded' } });
  } else if (status === 'cancelled') {
    await s.append(runEvents.cancelled(identity), { transition: { status: 'cancelled' } });
  } else {
    const message = reason ?? 'The orchestration stopped.';
    const code = s.budgetHit ? 'budget_exceeded' : 'orchestration_failed';
    await s.append(runEvents.error(message, code), {
      transition: { status: 'failed', error: message },
    });
  }
}

function withNotes(text: string, notes: readonly string[], hasMessage: boolean): string {
  if (notes.length === 0) return text;
  const joined = notes.join('\n\n');
  return text || hasMessage ? `${text}\n\n${joined}` : joined;
}

export async function orchestrate(deps: OrchestratorDeps, lease: Lease): Promise<void> {
  const input = await loadRunInput(deps.db, lease.runId);
  const append: Append = (event, options) => appendRunEvent(deps.db, lease, event, options);
  const control = startControl(deps, lease);
  let budgetTimer: NodeJS.Timeout | null = null;
  let session: Session | null = null;
  try {
    await append(runEvents.started(input.identity), { transition: { status: 'running' } });
    const intake = await decideIntake(deps, input, append);
    const mode = input.mode ?? 'chat';
    const risk = trustedRisk(mode, intake.body.jev);
    const intakeGate = intake.body.gate?.decision ?? null;
    const depth = refineDepth(
      chooseDepth(mode, risk, intake.body.jev, intakeGate),
      risk,
      namedFiles([input.userRequest]).length,
      intake.body.jev,
    );
    const review = reviewIntent(mode, intake.body.jev, input.userRequest);
    const note = intakeDepthNote(depth, review);
    if (note) await noteIntakeDepth(deps.db, lease.runId, { depth: depth.depth, reason: note });
    const vague =
      mode === 'do' &&
      input.history.length === 0 &&
      isVagueRequest(input.userRequest, namedFiles([input.userRequest]).length, intake.body.jev);
    const limits = baseLimits(deps, input.provider);
    const root = input.projectRoots[0];
    const worktrees = mode === 'do' && root !== undefined && (await isGitWorkTree(root));
    await insertOrchestration(deps.db, {
      runId: lease.runId,
      depth: depth.depth,
      depthSource: depth.source,
      risk,
      routing: intake.context.routing,
      activeLimitMs: limits.activeLimitMs,
      toolCallLimit: limits.toolCallLimit,
      costCapUsd: limits.costCapUsd,
    });
    const s: Session = {
      deps,
      lease,
      input,
      append,
      control,
      jev:
        deps.intake && intake.context.jevModel
          ? {
              deps: { ...deps.intake.deps, timeoutMs: jevTimeout(deps) },
              model: intake.context.jevModel,
            }
          : null,
      route: routeContext(input, intake, risk),
      intake,
      flow: initialFlow(depth.depth, risk, input.level, worktrees, review),
      routes: new Map(),
      planned: new Map(),
      plannedCalled: false,
      plan: [],
      planVersion: null,
      taskId: null,
      inPlaceUsed: false,
      snapshotTaken: false,
      message: null,
      results: [],
      findings: [],
      toolCalls: 0,
      limits,
      baseLimits: limits,
      startedAt: Date.now(),
      budgetHit: null,
      members: new Map(),
      checkpoints: 0,
      names: new Map(),
      research: [],
      architectNotes: null,
      slots: new Slots(deps.parallelLimit ?? ORCHESTRATION_PARALLEL_LIMIT),
      groups: 0,
      parallelNoted: false,
      git: worktrees,
      checks:
        mode === 'do' && root !== undefined
          ? await projectChecks(deps.db, lease.runId, root)
          : null,
      checkRounds: 0,
      checkBodies: [],
      reviews: null,
      projectStyle:
        mode === 'do' && root !== undefined ? await projectBuildStyle(deps.db, lease.runId) : 'off',
      buildStyle: 'off',
      buildStyleDecided: false,
      lanePlacement: null,
      assumption: null,
    };
    session = s;
    budgetTimer = setInterval(
      () => void checkBudget(s).catch(() => undefined),
      deps.budgetPollMs ?? 1000,
    );
    const handling = vague ? vagueHandling(input.level) : null;
    if (handling === 'assume') {
      const [likely] = interpretations(intakeResponse(s));
      if (likely) await assume(s, likely);
    }
    await drive(
      s,
      handling === 'ask'
        ? 'interpret'
        : intakeGate === 'ask' && mode === 'do'
          ? 'ask'
          : intakeGate === 'act'
            ? 'act'
            : 'fallback',
    );
  } catch (error) {
    if (error instanceof LeaseLostError || control.reason() === 'lease_lost') return;
    await failSafely(append, error);
  } finally {
    if (budgetTimer) clearInterval(budgetTimer);
    if (session) await settleSession(session);
    control.dispose();
  }
}

async function settleSession(s: Session): Promise<void> {
  for (const abort of s.members.values()) abort();
  await s.reviews?.collect().catch(() => undefined);
  await cleanupCopies(s).catch(() => undefined);
  if (s.taskId) {
    await closeKeyedSessions(
      s.deps.db,
      s.input.identity.threadId,
      `key:${s.taskId}:`,
      SESSION_CLOSE_REASONS.orchestrationDone,
    ).catch(() => undefined);
  }
  if (s.input.mode === 'do') await recordKeptChanges(s.deps.db, s.input.workspaceId, s.lease.runId);
}

async function drive(
  s: Session,
  intake: Extract<FlowEvent, { type: 'start' }>['intake'],
): Promise<void> {
  let result = nextStep(s.flow, { type: 'start', intake });
  for (;;) {
    s.flow = result.state;
    await noteSequential(s);
    if (result.action.type === 'finish') {
      await perform(s, result.action);
      return;
    }
    await save(s);
    let event: FlowEvent | null;
    try {
      event =
        s.control.signal.aborted && s.control.reason() === 'cancelled'
          ? { type: 'stopped' }
          : await perform(s, result.action);
    } catch (error) {
      if (!(error instanceof CheckpointTimeout)) throw error;
      await finish(s, 'failed', APPROVAL_TIMEOUT_MESSAGE);
      return;
    }
    if (!event) return;
    if (s.control.reason() === 'cancelled' && event.type !== 'stopped') event = { type: 'stopped' };
    result = nextStep(s.flow, event);
    await recordStepOutcome(s, event, result.action);
  }
}

async function noteSequential(s: Session): Promise<void> {
  if (s.flow.worktrees || s.flow.groups.length === 0 || s.parallelNoted) return;
  const note = sequentialReason(s.flow.groups, s.flow.steps);
  if (!note) return;
  s.parallelNoted = true;
  await save(s, { parallelNote: note });
}

async function recordStepOutcome(s: Session, event: FlowEvent, action: FlowAction) {
  const last = s.results.at(-1);
  const status = statusAfterJudging(event, action, last);
  if (!last || !status) return;
  if (status === 'completed') {
    await markPlanSteps(s, last.steps, status, last.runId);
    return;
  }
  const open = last.steps.find((index) => !last.ticked.includes(index)) ?? last.stepIndex;
  await markPlanStep(s, open, status, last.runId);
}

async function failSafely(append: Append, error: unknown): Promise<void> {
  console.error('Orchestration failed', error);
  const message =
    'The orchestration stopped with an unexpected error. Nothing after the last completed step was changed.';
  try {
    await append(runEvents.error(message, 'orchestration_failed'), {
      transition: { status: 'failed', error: message },
    });
  } catch (appendError) {
    if (!(appendError instanceof LeaseLostError)) throw appendError;
  }
}
