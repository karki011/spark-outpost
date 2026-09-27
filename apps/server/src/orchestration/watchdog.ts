import type { AgentRole } from '@spark-outpost/contracts';
import { hasPendingApproval } from '../persistence/approvals.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import type { ProviderOutput } from '../providers/provider.ts';
import { stuckCard } from './checkpoint.ts';
import { callJev, type JevCall } from './jev-calls.ts';
import type { OrchestratorDeps, Session } from './session.ts';
import { askStuck } from './watchdog-ask.ts';
import { buildWatchdogQuestions, parseWatchdog, type WatchFacts } from './watchdog-questions.ts';
import {
  DEFAULT_WATCH_SETTINGS,
  dueCheck,
  flagLines,
  markChecked,
  newCounters,
  nudgeText,
  reasonText,
  remember,
  repeatFlags,
  ruleVerdict,
  watchAction,
  watchSummary,
  watchVerdict,
  type ToolCall,
  type WatchAction,
  type WatchCounters,
  type WatchSettings,
  type WatchTrigger,
  type WatchVerdict,
} from './watchdog-rules.ts';

export interface WatchdogState {
  calls: number;
  asking: boolean;
  nudges: Map<string, string>;
}

export interface WatchedMember {
  runId: string;
  childRunId: string | null;
  name: string;
  role: AgentRole;
  stepIndex: number;
  steps: readonly number[];
  ticked: () => readonly number[];
}

export interface MemberWatch {
  observe(output: ProviderOutput): void;
  stop(): Promise<void>;
}

const idleWatch: MemberWatch = { observe: () => undefined, stop: async () => undefined };

export function watchSettings(deps: OrchestratorDeps): WatchSettings | null {
  if (deps.watchdog === false) return null;
  return { ...DEFAULT_WATCH_SETTINGS, ...deps.watchdog };
}

export function watchdogState(s: Session): WatchdogState {
  s.watchdog ??= { calls: 0, asking: false, nudges: new Map() };
  return s.watchdog;
}

export function takeNudge(s: Session, name: string): string | null {
  const state = watchdogState(s);
  const nudge = state.nudges.get(name) ?? null;
  state.nudges.delete(name);
  return nudge;
}

interface Watcher {
  s: Session;
  member: WatchedMember;
  settings: WatchSettings;
  counters: WatchCounters;
  recent: ToolCall[];
  ended: AbortSignal;
  checks: number;
  lastActionCheck: number | null;
}

const skipped: JevCall = {
  status: 'not_connected',
  asked: null,
  response: null,
  error: null,
  latencyMs: null,
  usage: null,
  model: null,
};

function facts(w: Watcher, trigger: WatchTrigger): WatchFacts {
  const flags = repeatFlags(w.recent);
  return {
    role: w.member.role,
    steps: w.member.steps.map((index) => w.s.flow.steps[index] ?? '').filter(Boolean),
    ticked: w.member.ticked().length,
    recent: [...w.recent],
    flags: flagLines(flags, trigger),
    trigger,
  };
}

async function askJev(w: Watcher, known: WatchFacts): Promise<JevCall> {
  const state = watchdogState(w.s);
  if (!w.s.jev || state.calls >= w.settings.callBudget) return skipped;
  state.calls += 1;
  return callJev(
    w.s.jev,
    () => buildWatchdogQuestions(known),
    AbortSignal.any([w.s.control.signal, w.ended]),
  );
}

function worthRecording(w: Watcher, call: JevCall, verdict: WatchVerdict): boolean {
  if (w.ended.aborted && !call.response) return false;
  return call.status !== 'not_connected' || verdict.stuck;
}

async function act(w: Watcher, action: WatchAction, nudge: string, reason: string) {
  const state = watchdogState(w.s);
  if (action === 'nudge') {
    state.nudges.set(w.member.name, nudge);
    return;
  }
  if (action !== 'checkpoint') return;
  state.asking = true;
  try {
    const answer = await askStuck(w.s, stuckCard(w.member.name, reason), w.ended);
    if (answer === 'nudge') state.nudges.set(w.member.name, nudge);
    if (answer === 'stop') w.s.control.stop('cancelled');
  } finally {
    state.asking = false;
  }
}

async function check(w: Watcher, trigger: WatchTrigger): Promise<void> {
  if (trigger === 'silence' && (await hasPendingApproval(w.s.deps.db, w.member.runId))) return;
  const known = facts(w, trigger);
  const flags = repeatFlags(w.recent);
  const rule = ruleVerdict(flags);
  const call = await askJev(w, known);
  const answers = call.response ? parseWatchdog(call.response) : null;
  const verdict = watchVerdict(answers, rule);
  w.checks += 1;
  const action = watchAction(verdict, {
    level: w.s.input.level,
    checksSinceAction: w.lastActionCheck === null ? null : w.checks - w.lastActionCheck,
    asking: watchdogState(w.s).asking,
    memberEnded: w.ended.aborted,
  });
  if (action === 'checkpoint' || action === 'nudge') w.lastActionCheck = w.checks;
  const reason = verdict.reason ? reasonText(verdict.reason, flags) : null;
  if (worthRecording(w, call, verdict)) {
    await insertDecision(w.s.deps.db, {
      runId: w.s.lease.runId,
      purpose: 'watchdog',
      childRunId: w.member.childRunId,
      role: w.member.role,
      stepIndex: w.member.stepIndex,
      jevStatus: answers ? 'answered' : call.status === 'answered' ? 'failed' : call.status,
      inputTokens: call.usage?.inputTokens ?? null,
      costUsd: call.usage?.costUsd ?? null,
      body: {
        summary: watchSummary(w.member.name, verdict, action, rule, flags),
        applied: verdict.source,
        gate: null,
        jevError: answers || !call.error ? null : call.error,
        jevModel: call.model,
        latencyMs: call.latencyMs,
        answer: {
          member: w.member.name,
          trigger,
          toolCalls: w.counters.toolCalls,
          flagged: verdict.stuck,
          reason: verdict.reason,
          reasonText: reason,
          action,
          jev: answers,
          rules: rule,
          flags: known.flags,
        },
        state: call.asked?.state ?? null,
        questions: call.asked?.questions ?? null,
        answers: call.response?.answers ?? null,
      },
    });
  }
  if (verdict.reason && reason) await act(w, action, nudgeText(verdict.reason, flags), reason);
}

function observeOutput(w: Watcher, output: ProviderOutput, onDue: () => void): void {
  w.counters.lastOutputAt = Date.now();
  if (output.kind === 'step_started' && output.tool) {
    w.counters.toolCalls += 1;
    remember(w.recent, { title: output.name, kind: output.toolKind ?? null });
  }
  onDue();
}

export function watchMember(s: Session, member: WatchedMember): MemberWatch {
  const settings = watchSettings(s.deps);
  if (!settings) return idleWatch;
  const local = new AbortController();
  const w: Watcher = {
    s,
    member,
    settings,
    counters: newCounters(Date.now()),
    recent: [],
    ended: local.signal,
    checks: 0,
    lastActionCheck: null,
  };
  let running: Promise<void> = Promise.resolve();
  const maybeCheck = () => {
    if (local.signal.aborted || s.control.signal.aborted) return;
    const trigger = dueCheck(w.counters, Date.now(), settings);
    if (!trigger) return;
    markChecked(w.counters, trigger);
    running = check(w, trigger)
      .catch((error: unknown) => console.warn('Watchdog check failed', error))
      .finally(() => {
        w.counters.inFlight = false;
      });
  };
  const timer = setInterval(maybeCheck, settings.pollMs);
  timer.unref();
  return {
    observe: (output) => observeOutput(w, output, maybeCheck),
    async stop() {
      clearInterval(timer);
      local.abort();
      await running;
    },
  };
}
