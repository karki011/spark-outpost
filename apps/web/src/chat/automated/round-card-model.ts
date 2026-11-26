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

export function roundBlocks<T extends { run: { prFollowUp?: boolean | undefined } }>(
  turns: readonly T[],
): T[][] {
  const blocks: T[][] = [];
  for (const turn of turns) {
    const last = blocks.at(-1);
    if (turn.run.prFollowUp && last?.[0]?.run.prFollowUp) last.push(turn);
    else blocks.push([turn]);
  }
  return blocks;
}

export interface RoundMember {
  runId: string;
  found: TurnRound | null;
}

export function roundsByPull(members: readonly RoundMember[]): RoundMember[][] {
  const groups: RoundMember[][] = [];
  for (const member of members) {
    const last = groups.at(-1);
    const pull = member.found?.watch.id;
    if (pull !== undefined && last?.[0]?.found?.watch.id === pull) last.push(member);
    else groups.push([member]);
  }
  return groups;
}

export function groupTitle(members: readonly RoundMember[]): string {
  const number = members[0]?.found?.watch.number;
  const pr = number === undefined ? 'PR follow-up' : `PR #${number}`;
  return `${pr} · ${members.length} rounds`;
}

function totals(outcomes: readonly RoundOutcome[]): string {
  const replied = outcomes.reduce((sum, outcome) => sum + outcome.replied, 0);
  const pushes = outcomes.filter((outcome) => outcome.pushed).length;
  const needs = outcomes.reduce((sum, outcome) => sum + outcome.needs, 0);
  const done = [
    replied > 0 ? `replied to ${plural(replied, 'comment', 'comments')}` : null,
    pushes > 0 ? `pushed ${pushes === 1 ? 'once' : `${pushes} times`}` : null,
  ].filter((part): part is string => part !== null);
  const text = done.length > 0 ? done.join(', ') : 'nothing changed';
  const waits = needs > 0 ? `; ${plural(needs, 'item needs', 'items need')} you` : '';
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${waits}`;
}

export function groupSubtitle(members: readonly RoundMember[], liveRunId: string | null): string {
  const live = members.find((member) => member.runId === liveRunId);
  if (live) {
    const round = live.found?.round;
    return round === null || round === undefined
      ? 'A round is working'
      : `Round ${round} is working`;
  }
  const outcomes = members.flatMap((member) =>
    member.found?.outcome ? [member.found.outcome] : [],
  );
  const sum = totals(outcomes);
  const last = members.at(-1)?.found ?? null;
  if (!last?.outcome) return sum;
  const latest = roundSubtitle(last, '', false);
  return `${sum} · last: ${latest.charAt(0).toLowerCase()}${latest.slice(1)}`;
}
