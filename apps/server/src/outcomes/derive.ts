import {
  CHECKPOINT_OPTION,
  type Category,
  type CheckStatus,
  type OutcomeKind,
  type OutcomeSignalKind,
  type OutcomeSignalSource,
  type RunStatus,
} from '@spark-outpost/contracts';
import { classifyFollowUp, polarityOf } from './signals.ts';

export const FOLLOW_UP_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface AcceptDecision {
  optionId: string;
  decidedAt: Date;
}

export interface FollowUpTurn {
  runId: string;
  text: string;
  category: Category | null;
  classified: boolean;
  sameChat: boolean;
  createdAt: Date;
}

export interface TurnFacts {
  runId: string;
  taskId: string | null;
  status: RunStatus;
  finishedAt: Date | null;
  revertedAt: Date | null;
  depth: string | null;
  request: string;
  changedFiles: boolean;
  accepts: AcceptDecision[];
  checks: { status: CheckStatus; at: Date } | null;
  followUps: FollowUpTurn[];
}

export interface DerivedSignal {
  kind: OutcomeSignalKind;
  polarity: -1 | 0 | 1;
  source: OutcomeSignalSource;
  at: Date;
  detail: Record<string, unknown>;
}

function signal(
  kind: OutcomeSignalKind,
  source: OutcomeSignalSource,
  at: Date,
  detail: Record<string, unknown> = {},
): DerivedSignal {
  return { kind, polarity: polarityOf(kind), source, at, detail };
}

const KEEP_CARD_SIGNALS: Record<string, OutcomeSignalKind> = {
  [CHECKPOINT_OPTION.keep]: 'kept',
  [CHECKPOINT_OPTION.revert]: 'reverted',
  [CHECKPOINT_OPTION.fix]: 'correction',
  [CHECKPOINT_OPTION.fixFindings]: 'correction',
};

export function outcomeKind(facts: TurnFacts): OutcomeKind {
  const decided = facts.accepts.some(
    (accept) =>
      accept.optionId === CHECKPOINT_OPTION.keep || accept.optionId === CHECKPOINT_OPTION.revert,
  );
  if (decided) return 'change';
  const direct = facts.depth === 'direct' || facts.depth === null;
  if (facts.status === 'succeeded' && direct && !facts.changedFiles) return 'answer';
  return 'other';
}

function keepCardSignals(facts: TurnFacts): DerivedSignal[] {
  const found = new Map<OutcomeSignalKind, DerivedSignal>();
  for (const accept of facts.accepts) {
    const kind = KEEP_CARD_SIGNALS[accept.optionId];
    if (!kind || found.has(kind)) continue;
    const detail = kind === 'correction' ? { via: 'keep_card' } : {};
    found.set(kind, signal(kind, 'user', accept.decidedAt, detail));
  }
  if (facts.revertedAt && !found.has('reverted')) {
    found.set('reverted', signal('reverted', 'user', facts.revertedAt, { via: 'revert_button' }));
  }
  return [...found.values()];
}

function statusSignals(facts: TurnFacts): DerivedSignal[] {
  const at = facts.finishedAt ?? new Date(0);
  if (facts.status === 'cancelled') return [signal('cancelled', 'harness', at)];
  if (facts.status === 'failed' || facts.status === 'outcome_unknown') {
    return [signal('failed', 'harness', at, { status: facts.status })];
  }
  return [];
}

function checkSignals(facts: TurnFacts): DerivedSignal[] {
  if (!facts.checks || facts.checks.status === 'skipped') return [];
  const kind = facts.checks.status === 'passed' ? 'checks_passed' : 'checks_failed';
  return [signal(kind, 'harness', facts.checks.at)];
}

function withinWindow(facts: TurnFacts, turn: FollowUpTurn): boolean {
  if (!facts.finishedAt) return false;
  const gap = turn.createdAt.getTime() - facts.finishedAt.getTime();
  return gap <= FOLLOW_UP_WINDOW_MS;
}

function followUpSignals(facts: TurnFacts): DerivedSignal[] {
  const found = new Map<OutcomeSignalKind, DerivedSignal>();
  const context = { request: facts.request, changedFiles: facts.changedFiles };
  const sorted = [...facts.followUps].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const nextInChat = sorted.find((turn) => turn.sameChat);
  const candidates = sorted.filter((turn) => !turn.sameChat || turn === nextInChat);
  for (const turn of candidates) {
    if (!turn.classified || !withinWindow(facts, turn)) continue;
    const classified = classifyFollowUp(context, {
      text: turn.text,
      jevCategory: turn.category,
      sameChat: turn.sameChat,
    });
    if (!classified || found.has(classified.kind)) continue;
    const gapMinutes = facts.finishedAt
      ? Math.round((turn.createdAt.getTime() - facts.finishedAt.getTime()) / 60_000)
      : null;
    found.set(
      classified.kind,
      signal(classified.kind, classified.source, turn.createdAt, {
        ...classified.detail,
        followUpRunId: turn.runId,
        gapMinutes,
      }),
    );
  }
  return [...found.values()];
}

function pendingFollowUp(facts: TurnFacts): boolean {
  return facts.followUps.some((turn) => !turn.classified && withinWindow(facts, turn));
}

function quietSignal(facts: TurnFacts, derived: readonly DerivedSignal[], now: Date) {
  if (facts.status !== 'succeeded' || !facts.finishedAt) return [];
  const quietAt = new Date(facts.finishedAt.getTime() + FOLLOW_UP_WINDOW_MS);
  if (now < quietAt || pendingFollowUp(facts)) return [];
  const complaint = derived.some((found) =>
    ['correction', 're_ask', 'reverted'].includes(found.kind),
  );
  return complaint ? [] : [signal('quiet_24h', 'timer', quietAt)];
}

export function deriveSignals(facts: TurnFacts, now: Date): DerivedSignal[] {
  const derived = [
    ...keepCardSignals(facts),
    ...statusSignals(facts),
    ...checkSignals(facts),
    ...followUpSignals(facts),
  ];
  return [...derived, ...quietSignal(facts, derived, now)];
}

export function followUpWindowClosed(facts: TurnFacts, now: Date): boolean {
  if (!facts.finishedAt) return false;
  return (
    now.getTime() - facts.finishedAt.getTime() >= FOLLOW_UP_WINDOW_MS && !pendingFollowUp(facts)
  );
}
