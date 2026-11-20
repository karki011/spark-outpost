import {
  roundOutcomeLine,
  type FeedbackItem,
  type FeedbackTriage,
  type PrWatch,
  type RoundOutcome,
} from '@spark-outpost/contracts';
import { roundSummary } from '../pull-request/round-model.ts';

export interface TurnRound {
  watch: PrWatch;
  round: number | null;
  outcome: RoundOutcome | null;
}

export function roundOfTurn(watches: readonly PrWatch[], runId: string): TurnRound | null {
  for (const watch of watches) {
    const outcome = watch.roundOutcomes?.find((entry) => entry.runId === runId) ?? null;
    if (outcome) return { watch, round: outcome.round, outcome };
    if (watch.roundRunId === runId) {
      return { watch, round: watch.rounds > 0 ? watch.rounds : null, outcome: null };
    }
  }
  return null;
}

export function roundItems(found: TurnRound): FeedbackItem[] {
  if (found.round === null) return [];
  return found.watch.items.filter((item) => item.round === found.round);
}

export const TRIAGE_WORDS: Record<FeedbackTriage, string> = {
  fix: 'Fix',
  question: 'Answer',
  disagree: 'Push back',
  nit: 'Nit',
  addressed: 'Addressed',
  info: 'Note',
};

export function itemWord(item: FeedbackItem): string {
  return item.kind === 'check' ? 'Check' : TRIAGE_WORDS[item.triage];
}

export function itemPlace(item: FeedbackItem): string {
  if (item.path === null) return item.author;
  const place = item.line === null ? item.path : `${item.path}:${item.line}`;
  return `${item.author} · ${place}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function roundTitle(found: TurnRound | null): string {
  if (!found) return 'PR follow-up';
  const pr = `PR #${found.watch.number}`;
  return found.round === null ? pr : `${pr} · round ${found.round}`;
}

export function roundSubtitle(found: TurnRound | null, message: string, live: boolean): string {
  if (found?.outcome) {
    const did = roundOutcomeLine(found.outcome).replace(/^Follow-up /, '');
    return did.charAt(0).toUpperCase() + did.slice(1);
  }
  const items = found ? roundItems(found).length : 0;
  const why =
    items > 0 ? `${plural(items, 'review item', 'review items')} arrived` : roundSummary(message);
  return live ? `${why} · sent by Spark` : why;
}
