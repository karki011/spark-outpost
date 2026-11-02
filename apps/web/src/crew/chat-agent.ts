import { type ActivityStep, type BackgroundWait, type Run } from '@spark-outpost/contracts';
import { timedOut, WAITED_LABEL } from '../chat/approvals/timed-out.ts';
import { AGENT_DEFAULT } from '../chat/composer/model-options.ts';
import { providerName } from '../chat/provider-name.ts';
import type { LeadStep } from '../chat/turn/live-label.ts';
import { waitLabel } from '../chat/wait-label.ts';
import { prettyModelId } from '../tasks/model-names.ts';
import { CHAT_AGENT_ROLE, type CrewAgent, type CrewState } from './crew-model.ts';
import { runState, stepLine } from './crew-projection.ts';

const LINE_CHARS = 60;

function leadLine(step: LeadStep): string {
  const line = stepLine(step.label);
  return line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS - 1).trimEnd()}…` : line;
}

const SETTLED_LINES: Partial<Record<CrewState, string>> = {
  queued: 'queued',
  waiting: 'waiting for you',
  stopped: 'stopped',
  failed: 'hit a problem',
  done: 'done',
};

function agentState(
  run: Run,
  steps: readonly ActivityStep[],
  asking: boolean,
  live: LeadStep | null,
  current: string | null,
): CrewState {
  if (timedOut(run.error)) return 'stopped';
  const state = runState(run.status);
  if (state !== 'working') return state;
  if (asking) return 'waiting';
  if (live) return live.label === 'Thinking' ? 'thinking' : 'working';
  return steps.length > 0 || current ? 'working' : 'thinking';
}

function agentLine(
  run: Run,
  state: CrewState,
  steps: readonly ActivityStep[],
  waitingOn: number,
  background: BackgroundWait | null,
  live: LeadStep | null,
  current: string | null,
): string {
  if (timedOut(run.error)) return WAITED_LABEL;
  const settled = SETTLED_LINES[state];
  if (settled) return settled;
  if (waitingOn > 0) return waitLabel(waitingOn, background).toLowerCase();
  if (live) return leadLine(live);
  const open = steps.findLast((step) => !step.done)?.name ?? current;
  return open ? stepLine(open) : 'thinking';
}

export function modelOf(run: Run): string | null {
  const ran = run.usedModel ?? run.model;
  return ran && ran !== AGENT_DEFAULT ? prettyModelId(ran) : null;
}

function durationMs(run: Run): number | null {
  if (!run.startedAt || !run.finishedAt) return null;
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export function chatAgent(
  run: Run,
  steps: readonly ActivityStep[] = [],
  asking = false,
  waitingOn = 0,
  background: BackgroundWait | null = null,
  live: LeadStep | null = null,
  current: string | null = null,
): CrewAgent {
  const state = agentState(run, steps, asking, live, current);
  return {
    id: run.id,
    role: CHAT_AGENT_ROLE,
    name: providerName(run.provider),
    provider: run.provider,
    model: modelOf(run),
    effort: run.effort,
    state,
    line: agentLine(run, state, steps, waitingOn, background, live, current),
    tokens: run.usage?.tokens?.total ?? null,
    costUsd: run.usage?.costUsd ?? null,
    costSource: run.usage?.costSource ?? null,
    durationMs: durationMs(run),
  };
}
