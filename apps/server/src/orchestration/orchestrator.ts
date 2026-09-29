import { newId } from '../persistence/ids.ts';
import type { Lease } from '../persistence/jobs.ts';
import { insertOrchestration } from '../persistence/orchestrations.ts';
import { recordKeptChanges } from '../outcomes/record.ts';
import { LeaseLostError, appendRunEvent } from '../persistence/run-events.ts';
import { currentTaskContext, startNewTask, taskForWorkingRun } from '../persistence/tasks.ts';
import { revertRun } from '../projects/run-changes.ts';
import { isGitWorkTree } from '../projects/snapshot.ts';
import { runAgentTurn, startControl, type Append } from '../workflow/agent-turn.ts';
import { APPROVAL_TIMEOUT_MESSAGE } from '../workflow/approval-gate.ts';
import { closeMessage, finishRun } from '../workflow/execute-run.ts';
import { runEvents } from '../workflow/run-events.ts';
import { noteProjectMove } from '../workflow/project-move.ts';
import { loadRunInput } from '../workflow/run-input.ts';
import { sparkPreferences } from '../persistence/setup.ts';
import { closeKeyedSessions } from '../persistence/provider-sessions.ts';
import { projectChecks } from '../checks/project-checks.ts';
import { checkBudget, fixRoundShort } from './budget-check.ts';
import { checksFailing } from './check-results.ts';
import { correctnessFindings, sessionReviewLine, suggestionsLine } from './critic-fix.ts';
import { CheckpointTimeout } from './checkpoint.ts';
import {
  confirmsRiskyFirst,
  KEPT_AFTER_EACH_EDIT,
  KEPT_BY_AUTO_EDIT,
  riskyChange,
} from './checkpoint-policy.ts';
import { missingContext } from './missing-context.ts';
import { migrationByRule } from './risk-rules.ts';
import { wrappedUp } from './wrap-up.ts';
import { ask } from './checkpoint-asks.ts';
import { assumptionLine } from './clarify.ts';
import { readOnlyStart, type CurrentTask, type IntakeDecisions } from './intake.ts';
import { orchestrationJevDeps, routeContext, runIntake } from './intake-run.ts';
import { buildAndLand } from './land.ts';
import {
  beginFixRound,
  cutFacts,
  notePassing,
  restoreAfterCut,
  startsFixRound,
} from './fix-rounds.ts';
import { finalText } from './final-message.ts';
import {
  decideBuildStyle,
  NO_PROJECT_STYLE,
  projectBuildStyle,
  recordShortcuts,
} from './build-style.ts';
import { agreedPlanText, changesSoFar } from './member-prompts.ts';
import { writePlanOnly } from './plan-only.ts';
import { writePlanFirst } from './plan-first.ts';
import { clarifyTurn } from './clarify-turn.ts';
import { observePlanAgreement } from './plan-agreement.ts';
import { refreshPlan } from './plan-progress.ts';
import { wantsCritic } from './critic-rule.ts';
import { buildInCopy, cleanupCopies, needsCopyFor, repoBusy } from './solo-copy.ts';
import { autoKeep, shipFullAuto } from './full-auto-ship.ts';
import {
  baseLimits,
  builderKey,
  publish,
  save,
  type OrchestratorDeps,
  type Session,
} from './session.ts';
import {
  ESCALATED_NOTE,
  initialFlow,
  nextStep,
  type FlowAction,
  type FlowEvent,
} from './transitions.ts';
import type { MemberOutcome } from './members.ts';
import { jevDiffsAllowed, settleObservations } from './observe.ts';
import { observeScan, startScan } from './observe-scan.ts';
import { verifyChange } from './verify.ts';

const TASK_SESSION_CLOSED = 'task session closed';
const NEW_TASK_STARTED = 'a new task started';

async function ensureTask(s: Session, current: CurrentTask | null): Promise<void> {
  if (s.taskId) return;
  if (current && !s.continuesTask) {
    const started = await startNewTask(s.deps.db, s.lease.runId, s.input.userRequest);
    s.taskId = started.taskId;
    if (started.closed) await closeTaskSessions(s, started.closed, NEW_TASK_STARTED);
    await s.append(runEvents.activity('task', 'task', { taskId: s.taskId, opened: true }));
    return;
  }
  const joined = await taskForWorkingRun(s.deps.db, s.lease.runId, s.input.userRequest);
  s.taskId = joined.task.taskId;
  await s.append(runEvents.activity('task', 'task', { taskId: s.taskId, opened: joined.opened }));
}

async function closeTaskSessions(s: Session, taskId: string, reason: string): Promise<void> {
  await closeKeyedSessions(
    s.deps.db,
    s.input.identity.threadId,
    `key:${builderKey(taskId)}`,
    reason,
  ).catch(() => undefined);
}

async function afterBuilder(s: Session, outcome: MemberOutcome): Promise<FlowEvent> {
  const { result } = outcome;
  if (result.loop && s.control.reason() !== 'cancelled') {
    return { type: 'looped', summary: result.loop, open: await refreshPlan(s) };
  }
  const open = result.outcome === 'succeeded' ? await refreshPlan(s) : undefined;
  const changes = result.outcome === 'succeeded' ? await changesSoFar(s) : null;
  const planned = changes ? (await agreedPlanText(s)) !== null : false;
  return {
    type: 'agent_done',
    role: 'builder',
    outcome: result.outcome === 'lease_lost' ? 'failed' : result.outcome,
    error: result.error,
    ...(open ? { open } : {}),
    ...(changes
      ? { large: wantsCritic(changes.files, planned), green: isGreen(s, changes.files) }
      : {}),
    ...(s.checkBodies.at(-1)?.status === 'failed' ? { checksFailing: true } : {}),
    missingContext: missingContext(result.text, result.error),
  };
}

function isGreen(s: Session, files: readonly unknown[]): boolean {
  return files.length > 0 && s.checkBodies.at(-1)?.status !== 'failed';
}

async function perform(s: Session, action: FlowAction): Promise<FlowEvent | null> {
  switch (action.type) {
    case 'ask':
      return ask(s, action);
    case 'spawn': {
      const hit = await checkBudget(s);
      if (hit) return { type: 'budget_exceeded', limit: hit, unstarted: true, ...cutFacts(s) };
      if (startsFixRound(s, action)) {
        const short = action.auto && !checksFailing(s) ? await fixRoundShort(s) : null;
        if (short) {
          return {
            type: 'budget_exceeded',
            limit: short,
            unstarted: true,
            round: true,
            passing: true,
          };
        }
        await beginFixRound(s);
      }
      const copied = action.role === 'builder' && s.needsCopy;
      const outcome = copied ? await buildInCopy(s, action) : await buildAndLand(s, action);
      const { result } = outcome;
      if (result.outcome === 'lease_lost') throw new LeaseLostError(s.lease);
      await publish(s);
      if (result.error === APPROVAL_TIMEOUT_MESSAGE) throw new CheckpointTimeout();
      if (s.budgetHit && s.control.reason() === null) {
        return { type: 'budget_exceeded', limit: s.budgetHit, ...cutFacts(s) };
      }
      if (action.role === 'builder') {
        if (s.flow.review.fixing && !checksFailing(s)) await notePassing(s);
        return afterBuilder(s, outcome);
      }
      if (action.role === 'critic') s.fixRound = null;
      const fixable =
        outcome.verdict === 'concerns' ? await correctnessFindings(s, result, s.findings) : [];
      return {
        type: 'agent_done',
        role: action.role,
        outcome: result.outcome,
        error: result.error,
        ...(outcome.verdict ? { verdict: outcome.verdict } : {}),
        ...(fixable.length > 0 ? { fixable } : {}),
      };
    }
    case 'plan':
      return writePlanOnly(s, action.note);
    case 'plan_first':
      return writePlanFirst(s, action.note);
    case 'ask_agent':
      return clarifyTurn(s, action.then);
    case 'verify':
      return verifyChange(s);
    case 'wrap_up':
      await recordShortcuts(s).catch(() => null);
      return wrappedUp(s);
    case 'keep':
      if (action.approvedEach) {
        await autoKeep(s, 'balanced', [KEPT_AFTER_EACH_EDIT]);
      } else {
        await autoKeep(s, 'hands-off', [KEPT_BY_AUTO_EDIT, sessionReviewLine(s)]);
      }
      return { type: 'kept' };
    case 'ship':
      return shipFullAuto(s);
    case 'restore':
      return restoreAfterCut(s);
    case 'revert':
      await revertRun(s.deps.db, s.input.workspaceId, s.lease.runId, true);
      s.closeReason = 'reverted';
      return { type: 'reverted' };
    case 'finish':
      await finish(s, action.status, action.reason, action.incomplete ?? null);
      return null;
  }
}

function withNotes(text: string, notes: readonly string[], hasMessage: boolean): string {
  if (notes.length === 0) return text;
  const joined = notes.join('\n\n');
  return text || hasMessage ? `${text}\n\n${joined}` : joined;
}

async function finish(
  s: Session,
  status: 'succeeded' | 'failed' | 'cancelled',
  reason: string | null,
  incomplete: string | null = null,
) {
  if (status === 'failed') s.closeReason ??= status;
  await cleanupCopies(s).catch(() => undefined);
  await settleObservations(s);
  const verdict = s.results.some((result) => result.role === 'critic') ? s.flow.verdict : null;
  const assumed = s.assumption ? assumptionLine(s.assumption) : null;
  const stopped = status === 'failed' && reason ? reason : null;
  const escalated = s.flow.escalated ? ESCALATED_NOTE : null;
  const fixed =
    s.flow.review.fixRounds > 0 || s.flow.review.stop === 'budget' || s.flow.review.stop === 'limit'
      ? sessionReviewLine(s)
      : null;
  const suggested = verdict ? suggestionsLine(s.suggestions ?? []) : null;
  const shipped = s.shipLine ?? null;
  const notes = [assumed, escalated, fixed, suggested, stopped, incomplete, shipped].filter(
    (line): line is string => line !== null,
  );
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

export async function orchestrate(deps: OrchestratorDeps, lease: Lease): Promise<void> {
  const taskStartedAt = Date.now();
  const append: Append = (event, options) => appendRunEvent(deps.db, lease, event, options);
  const input = await noteProjectMove(deps.db, await loadRunInput(deps.db, lease.runId), append);
  const control = startControl(deps, lease);
  let budgetTimer: NodeJS.Timeout | null = null;
  let session: Session | null = null;
  try {
    await append(runEvents.started(input.identity), { transition: { status: 'running' } });
    const mode = input.mode ?? 'chat';
    const root = input.projectRoots[0];
    const doing = mode === 'do' && root !== undefined;
    const solo = !(await sparkPreferences(deps.db, input.workspaceId)).sparkEnabled;
    if (solo && !doing) {
      const result = await runAgentTurn(deps, lease, input, append, control);
      await finishRun(append, input.identity, result, true);
      return;
    }
    const scanning = doing && !solo ? startScan({ deps, input }, root, taskStartedAt) : null;
    const current = doing ? await currentTaskContext(deps.db, lease.runId) : null;
    const { intake, decisions } = await runIntake(
      deps,
      input,
      append,
      input.projectMove ? null : current,
      solo,
    );
    await observePlanAgreement({ db: deps.db, runId: lease.runId, input, intake, append }).catch(
      (error: unknown) => console.error('Could not observe a plan agreement', error),
    );
    const answers = decisions.start === 'answer';
    const git = doing && (await isGitWorkTree(root));
    const limits = baseLimits(deps, input.provider);
    await insertOrchestration(deps.db, {
      runId: lease.runId,
      depth: readOnlyStart(decisions.start) ? 'direct' : 'execute',
      depthSource: Object.values(decisions.calls).some((call) => call.source === 'jev')
        ? 'jev'
        : 'rules',
      risk: decisions.risk,
      routing: intake.context.routing,
      activeLimitMs: limits.activeLimitMs,
      toolCallLimit: limits.toolCallLimit,
      costCapUsd: limits.costCapUsd,
    });
    const busy = git && !answers ? await repoBusy(deps.db, lease.runId, root) : false;
    const risky = doing ? riskyChange(decisions.destructive, input.userRequest) : null;
    const confirmFirst = risky && confirmsRiskyFirst(input.level) ? risky : null;
    const jevDeps = solo ? null : orchestrationJevDeps(deps);
    const jev =
      jevDeps && intake.context.jevModel ? { deps: jevDeps, model: intake.context.jevModel } : null;
    const reviewWanted =
      decisions.review || risky !== null || (doing && migrationByRule(input.userRequest));
    const s: Session = {
      deps,
      lease,
      input,
      append,
      control,
      jev,
      route: routeContext(input, intake.context),
      facts: { trivial: decisions.trivial, destructive: decisions.destructive },
      intake,
      flow: {
        ...initialFlow(decisions.risk, input.level, reviewWanted, jev !== null, confirmFirst),
        ...(solo ? { solo } : {}),
      },
      risky,
      routes: new Map(),
      plan: [],
      taskId: null,
      continuesTask: decisions.continues === true && !input.projectMove,
      message: null,
      results: [],
      findings: [],
      toolCalls: 0,
      limits,
      baseLimits: limits,
      startedAt: Date.now(),
      budgetHit: null,
      members: new Map(),
      liveCost: new Map(),
      checkpoints: 0,
      git,
      checks: doing && !solo ? await projectChecks(deps.db, lease.runId, root) : null,
      checkRounds: 0,
      checkBodies: [],
      checkLines: [],
      projectStyle: doing ? await projectBuildStyle(deps.db, lease.runId) : NO_PROJECT_STYLE,
      buildStyle: 'off',
      assumption: null,
      needsCopy:
        git &&
        needsCopyFor({
          provider: input.provider,
          agentMode: input.agentMode,
          level: input.level,
          destructive: decisions.destructive,
          risky: risky !== null,
          busy,
        }),
      copyRunId: null,
      snapshotTaken: false,
      closeReason: null,
      observations: [],
      jevDiffs: !solo && (await jevDiffsAllowed(deps.db, input.workspaceId)),
    };
    session = s;
    observeScan(s, scanning);
    if (doing && !answers) {
      if (!solo) decideBuildStyle(s);
      await ensureTask(s, current);
    }
    budgetTimer = setInterval(() => {
      if (s.members.size > 0) void checkBudget(s).catch(() => undefined);
    }, deps.budgetPollMs ?? 1000);
    await drive(s, decisions);
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
  await cleanupCopies(s).catch(() => undefined);
  if (s.taskId && s.closeReason) await closeTaskSessions(s, s.taskId, TASK_SESSION_CLOSED);
  if (s.input.mode === 'do') await recordKeptChanges(s.deps.db, s.input.workspaceId, s.lease.runId);
}

async function drive(s: Session, decisions: IntakeDecisions): Promise<void> {
  let result = nextStep(s.flow, { type: 'start', start: decisions.start, then: decisions.then });
  for (;;) {
    s.flow = result.state;
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
  }
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
