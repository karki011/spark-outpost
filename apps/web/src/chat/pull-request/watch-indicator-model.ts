import {
  agentLabel,
  isTerminalRunStatus,
  roundOutcomeLine,
  type CrewMember,
  type PrPollProblem,
  type PrWatch,
  type Run,
} from '@spark-outpost/contracts';
import { needYou } from './pr-card-model.ts';
import { lastOutcome } from './relay-model.ts';

export type FollowUpMode = 'on' | 'ask' | 'off';

export type WatchState =
  | 'agent'
  | 'needs_you'
  | 'no_access'
  | 'paused'
  | 'off'
  | 'stopped'
  | 'waiting_checks'
  | 'waiting_review'
  | 'watching'
  | 'tracking';

type WatchTone = 'live' | 'warn' | 'quiet';

export interface RoundWorker {
  agent: string;
  member: string | null;
}

export interface WatchIndicator {
  state: WatchState;
  tone: WatchTone;
  watching: boolean;
  pulse: boolean;
  label: string;
  short: string | null;
  lines: string[];
  offer: 'follow_up' | 'ask' | null;
}

export interface IndicatorContext {
  mode: FollowUpMode;
  worker: RoundWorker | null;
  now: number;
  relay?: string | null;
}

const ACCESS_PROBLEMS: ReadonlySet<PrPollProblem> = new Set(['not_connected', 'no_access']);

export function watchState(watch: PrWatch, mode: FollowUpMode): WatchState | null {
  if (watch.prState !== 'open' || watch.phase === 'done') return null;
  if (watch.phase === 'fixing') return 'agent';
  if (watch.phase === 'confirming' || watch.phase === 'needs_you' || needYou(watch) > 0) {
    return 'needs_you';
  }
  if (watch.unknownReason || (watch.pollProblem && ACCESS_PROBLEMS.has(watch.pollProblem))) {
    return 'no_access';
  }
  if (watch.pollProblem) return 'paused';
  if (watch.followUp && mode === 'off') return 'off';
  if (watch.followUp && watch.quiet) return 'stopped';
  if (watch.checks === 'pending') return 'waiting_checks';
  if (watch.review === 'none' && !watch.draft && watch.checks !== 'failing') {
    return 'waiting_review';
  }
  return watch.followUp ? 'watching' : 'tracking';
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const STEP = 10 * SECOND;

function span(ms: number): string {
  if (ms < MINUTE) return `${Math.max(STEP, Math.floor(ms / STEP) * STEP) / SECOND}s`;
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  return `${Math.floor(ms / HOUR)} h`;
}

export function checkedLine(watch: Pick<PrWatch, 'lastPolledAt'>, now: number): string {
  if (!watch.lastPolledAt) return 'Not checked yet';
  const elapsed = now - new Date(watch.lastPolledAt).getTime();
  return elapsed < STEP ? 'Checked just now' : `Checked ${span(elapsed)} ago`;
}

function untilNext(watch: Pick<PrWatch, 'nextPollAt'>, now: number): string | null {
  if (!watch.nextPollAt) return null;
  const left = new Date(watch.nextPollAt).getTime() - now;
  return left < STEP ? 'any moment now' : `in ${span(left)}`;
}

export function nextLine(watch: Pick<PrWatch, 'nextPollAt'>, now: number): string | null {
  const when = untilNext(watch, now);
  return when ? `next check ${when}` : null;
}

function pollLine(watch: PrWatch, now: number): string {
  return [checkedLine(watch, now), nextLine(watch, now)].filter(Boolean).join(' · ');
}

const PAUSE_LINES: Record<PrPollProblem, string> = {
  not_connected: 'GitHub is not connected.',
  no_access: 'Your GitHub connection can’t read this repository.',
  rate_limit: 'GitHub’s rate limit is used up.',
  offline: 'Spark can’t reach GitHub.',
  error: 'The last check failed.',
};

const ERROR_CHARS = 120;

function briefError(error: string): string {
  const text = error.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  return text.length > ERROR_CHARS ? `${text.slice(0, ERROR_CHARS - 1)}…` : text;
}

function pauseLine(watch: PrWatch): string {
  const problem = watch.pollProblem ?? 'error';
  if (problem !== 'error' || !watch.lastError) return PAUSE_LINES[problem];
  return `The last check failed: ${briefError(watch.lastError)}.`;
}

function retryLine(watch: PrWatch, now: number): string | null {
  const when = untilNext(watch, now);
  return when ? `Spark tries again ${when}.` : null;
}

const STATUS_ONLY =
  'Spark shows checks and reviews here. It follows up only on pull requests from this chat’s own branch.';
const ASKS_FIRST = 'Spark asks before pushing and replying.';

function roundLabel(watch: Pick<PrWatch, 'rounds'>): string {
  return `Round ${watch.rounds}`;
}

const STOPPED_LINE =
  'The last round changed nothing, so Spark stopped following up. New feedback or a new commit starts it again, or ask in the chat for another round.';

function workerLine(worker: RoundWorker | null): string {
  if (!worker) return 'The agent';
  return worker.member ? `${worker.agent} · ${worker.member}` : worker.agent;
}

function needsLines(watch: PrWatch): string[] {
  const waiting = needYou(watch);
  const lines: string[] = [];
  if (watch.phase === 'confirming') lines.push('A card in this chat is waiting for you.');
  if (waiting > 0) {
    lines.push(`${waiting} ${waiting === 1 ? 'item is' : 'items are'} left for you.`);
  }
  if (watch.followUp && watch.quiet && watch.phase !== 'confirming') lines.push(STOPPED_LINE);
  return lines.length > 0 ? lines : [watch.doing];
}

function followNotes(watch: PrWatch, mode: FollowUpMode): string[] {
  if (!watch.followUp) return [STATUS_ONLY];
  return mode === 'ask' ? [ASKS_FIRST] : [];
}

type Shape = Pick<WatchIndicator, 'tone' | 'watching' | 'pulse' | 'label' | 'short' | 'lines'>;

function shape(state: WatchState, watch: PrWatch, context: IndicatorContext): Shape {
  const { mode, worker, now } = context;
  const polled = `${pollLine(watch, now)}.`;
  const idle = { tone: 'quiet', watching: true, pulse: false } as const;
  switch (state) {
    case 'agent':
      return {
        tone: 'live',
        watching: true,
        pulse: true,
        label: context.relay ? `${context.relay} is on it` : 'Agent is on it',
        short: context.relay ? `${context.relay} is on it` : 'Agent is on it',
        lines: [`${workerLine(worker)} is working on ${roundLabel(watch).toLowerCase()}.`],
      };
    case 'needs_you':
      return {
        tone: 'warn',
        watching: true,
        pulse: false,
        label: 'Needs you',
        short: needYou(watch) > 0 ? null : 'Needs you',
        lines: needsLines(watch),
      };
    case 'no_access':
      return {
        tone: 'warn',
        watching: false,
        pulse: false,
        label: 'Not watching',
        short: 'Not watching',
        lines: [
          watch.unknownReason ?? PAUSE_LINES[watch.pollProblem ?? 'no_access'],
          retryLine(watch, now),
        ].filter((line) => line !== null),
      };
    case 'paused':
      return {
        tone: 'warn',
        watching: false,
        pulse: false,
        label: 'Watching is paused',
        short: 'Paused',
        lines: [pauseLine(watch), retryLine(watch, now)].filter((line) => line !== null),
      };
    case 'off':
      return {
        tone: 'quiet',
        watching: false,
        pulse: false,
        label: 'Follow-up is off',
        short: 'Follow-up off',
        lines: [
          'Follow up on pull requests is off, so Spark won’t fix checks or answer reviews here. Checks and reviews still update.',
          polled,
        ],
      };
    case 'stopped':
      return {
        tone: 'quiet',
        watching: true,
        pulse: false,
        label: context.relay ? `${context.relay} stopped: nothing changed` : 'Stopped following up',
        short: 'Stopped',
        lines: [STOPPED_LINE, polled],
      };
    case 'waiting_checks':
      return {
        tone: 'live',
        watching: true,
        pulse: true,
        label: 'Waiting for checks',
        short: null,
        lines: ['Checks are running.', polled, ...followNotes(watch, mode)],
      };
    case 'waiting_review':
      return {
        ...idle,
        label: 'Waiting for review',
        short: 'Waiting for review',
        lines: ['No review yet.', polled, ...followNotes(watch, mode)],
      };
    case 'watching':
      return {
        ...idle,
        label: 'Spark is watching',
        short: 'Watching',
        lines: ['Spark is watching checks and reviews.', polled, ...followNotes(watch, mode)],
      };
    case 'tracking':
      return {
        ...idle,
        label: 'Spark is tracking',
        short: 'Tracking',
        lines: [STATUS_ONLY, polled],
      };
  }
}

function offerFor(state: WatchState, watch: PrWatch, mode: FollowUpMode) {
  if (!watch.followUp || state === 'agent') return null;
  if (mode === 'off') return 'follow_up';
  return mode === 'ask' ? 'ask' : null;
}

export function watchIndicator(watch: PrWatch, context: IndicatorContext): WatchIndicator | null {
  const state = watchState(watch, context.mode);
  if (!state) return null;
  const shaped = shape(state, watch, context);
  const outcome = context.relay && OUTCOME_STATES.has(state) ? lastOutcome(watch) : null;
  return {
    state,
    ...shaped,
    lines: outcome
      ? [`${roundOutcomeLine(context.relay!, outcome)}.`, ...shaped.lines]
      : shaped.lines,
    offer: offerFor(state, watch, context.mode),
  };
}

const OUTCOME_STATES: ReadonlySet<WatchState> = new Set([
  'needs_you',
  'waiting_checks',
  'waiting_review',
  'watching',
]);

export function indicatorTitle(indicator: WatchIndicator): string {
  return `${indicator.label}. ${indicator.lines.join(' ')}`;
}

export function watchLabel(watch: PrWatch, mode: FollowUpMode): string | null {
  return watchIndicator(watch, { mode, worker: null, now: 0 })?.label ?? null;
}

interface RoundSource {
  runs: readonly Pick<Run, 'id' | 'provider'>[];
  orchestrations?: Record<string, { crew: readonly RoundMember[] }> | undefined;
}

type RoundMember = Pick<CrewMember, 'role' | 'name' | 'provider' | 'status'>;

export function roundWorker(
  detail: RoundSource | undefined,
  roundRunId: string | null,
  agentName: (provider: string) => string,
): RoundWorker | null {
  const round = roundRunId ? detail?.runs.find((run) => run.id === roundRunId) : undefined;
  if (!round) return null;
  const member = detail?.orchestrations?.[round.id]?.crew.findLast(
    (entry) => !isTerminalRunStatus(entry.status),
  );
  return {
    agent: agentName((member ?? round).provider),
    member: member ? agentLabel(member.role, null, null, member.name) : null,
  };
}
