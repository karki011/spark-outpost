import type { InvolvementLevel } from '@spark-outpost/contracts';

export const WATCH_EVERY_TOOL_CALLS = 10;
export const WATCH_SILENCE_MS = 120_000;
export const WATCH_POLL_MS = 5_000;
export const WATCH_RECENT = 12;
export const WATCHDOG_CALL_BUDGET = 20;
export const STUCK_AT = 0.85;
export const FINE_AT_MOST = 0.3;
export const RULE_STREAK = 5;
export const ACTION_COOLDOWN_CHECKS = 2;

export interface WatchSettings {
  everyToolCalls: number;
  silenceMs: number;
  pollMs: number;
  callBudget: number;
}

export const DEFAULT_WATCH_SETTINGS: WatchSettings = {
  everyToolCalls: WATCH_EVERY_TOOL_CALLS,
  silenceMs: WATCH_SILENCE_MS,
  pollMs: WATCH_POLL_MS,
  callBudget: WATCHDOG_CALL_BUDGET,
};

export interface ToolCall {
  title: string;
  kind: string | null;
}

export type WatchTrigger = 'tool_calls' | 'silence';

export interface WatchCounters {
  toolCalls: number;
  checkedAt: number;
  lastOutputAt: number;
  silenceCheckedAt: number | null;
  inFlight: boolean;
}

export function newCounters(now: number): WatchCounters {
  return { toolCalls: 0, checkedAt: 0, lastOutputAt: now, silenceCheckedAt: null, inFlight: false };
}

export function dueCheck(
  counters: WatchCounters,
  now: number,
  settings: WatchSettings,
): WatchTrigger | null {
  if (counters.inFlight) return null;
  if (counters.toolCalls - counters.checkedAt >= settings.everyToolCalls) return 'tool_calls';
  const silent = now - counters.lastOutputAt >= settings.silenceMs;
  if (silent && counters.silenceCheckedAt !== counters.lastOutputAt) return 'silence';
  return null;
}

export function markChecked(counters: WatchCounters, trigger: WatchTrigger): void {
  counters.inFlight = true;
  if (trigger === 'tool_calls') counters.checkedAt = counters.toolCalls;
  else counters.silenceCheckedAt = counters.lastOutputAt;
}

export function remember(recent: ToolCall[], call: ToolCall): void {
  recent.push(call);
  if (recent.length > WATCH_RECENT) recent.splice(0, recent.length - WATCH_RECENT);
}

export interface RepeatFlags {
  streak: number;
  streakTitle: string | null;
  streakKind: string | null;
  topTitle: string | null;
  topCount: number;
  alternating: boolean;
}

function tailStreak(recent: readonly ToolCall[]): number {
  const last = recent.at(-1);
  if (!last) return 0;
  let count = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (recent[index]!.title !== last.title) break;
    count += 1;
  }
  return count;
}

function mostFrequent(recent: readonly ToolCall[]): { title: string | null; count: number } {
  const counts = new Map<string, number>();
  for (const call of recent) counts.set(call.title, (counts.get(call.title) ?? 0) + 1);
  let best: { title: string | null; count: number } = { title: null, count: 0 };
  for (const [title, count] of counts) if (count > best.count) best = { title, count };
  return best;
}

const ALTERNATION_ROUNDS = 3;

function alternates(recent: readonly ToolCall[]): boolean {
  const tail = recent.slice(-ALTERNATION_ROUNDS * 2).map((call) => call.title);
  if (tail.length < ALTERNATION_ROUNDS * 2) return false;
  const [first, second] = tail;
  if (first === second) return false;
  return tail.every((title, index) => title === (index % 2 === 0 ? first : second));
}

export function repeatFlags(recent: readonly ToolCall[]): RepeatFlags {
  const streak = tailStreak(recent);
  const last = recent.at(-1) ?? null;
  const top = mostFrequent(recent);
  return {
    streak,
    streakTitle: last?.title ?? null,
    streakKind: last?.kind ?? null,
    topTitle: top.title,
    topCount: top.count,
    alternating: alternates(recent),
  };
}

export function flagLines(flags: RepeatFlags, trigger: WatchTrigger): string[] {
  const lines: string[] = [];
  if (flags.streak >= 3) lines.push('the last call was repeated three or more times in a row');
  if (flags.topCount >= 4) lines.push('one call makes up a third or more of the recent calls');
  if (flags.alternating) lines.push('two calls alternate back and forth');
  if (trigger === 'silence') lines.push('no output for over two minutes');
  return lines;
}

export const WATCH_REASONS = ['repeating', 'off_step', 'waiting', 'finished'] as const;
export type WatchReason = (typeof WATCH_REASONS)[number];

export interface RuleVerdict {
  stuck: boolean;
  reason: WatchReason | null;
  note: string;
}

export function ruleVerdict(flags: RepeatFlags): RuleVerdict {
  const repeatsEdits = flags.streakKind === 'edit';
  if (flags.streak >= RULE_STREAK && !repeatsEdits) {
    return { stuck: true, reason: 'repeating', note: `${flags.streak} identical calls in a row` };
  }
  return { stuck: false, reason: null, note: 'no obvious repeat' };
}

export interface WatchAnswers {
  nouls: Partial<Record<WatchReason, number>>;
  worst: { reason: WatchReason; noul: number } | null;
}

export interface WatchVerdict {
  stuck: boolean;
  reason: WatchReason | null;
  source: 'jev' | 'rules';
  noul: number | null;
}

export function watchVerdict(jev: WatchAnswers | null, rule: RuleVerdict): WatchVerdict {
  const worst = jev?.worst ?? null;
  if (worst && worst.noul >= STUCK_AT) {
    return { stuck: true, reason: worst.reason, source: 'jev', noul: worst.noul };
  }
  if (worst && worst.noul <= FINE_AT_MOST) {
    return { stuck: false, reason: null, source: 'jev', noul: worst.noul };
  }
  return { stuck: rule.stuck, reason: rule.reason, source: 'rules', noul: worst?.noul ?? null };
}

export type WatchAction = 'none' | 'checkpoint' | 'nudge' | 'held';

export interface ActionContext {
  level: InvolvementLevel;
  checksSinceAction: number | null;
  asking: boolean;
  memberEnded: boolean;
}

export function asksWhenStuck(level: InvolvementLevel): boolean {
  return level === 'hands-on' || level === 'balanced';
}

export function watchAction(verdict: WatchVerdict, context: ActionContext): WatchAction {
  if (!verdict.stuck || context.memberEnded) return 'none';
  const cooling =
    context.checksSinceAction !== null && context.checksSinceAction < ACTION_COOLDOWN_CHECKS;
  if (cooling) return 'held';
  if (!asksWhenStuck(context.level)) return 'nudge';
  return context.asking ? 'held' : 'checkpoint';
}

export function reasonText(reason: WatchReason, flags: RepeatFlags): string {
  switch (reason) {
    case 'repeating': {
      const title = flags.streak >= 3 ? flags.streakTitle : flags.topTitle;
      return title ? `repeating ${title.replaceAll('`', '')}` : 'repeating the same actions';
    }
    case 'off_step':
      return 'working on something outside its step';
    case 'waiting':
      return 'waiting on something it cannot get';
    case 'finished':
      return 'looks finished but has not stopped';
  }
}

const NUDGE_ADVICE: Record<WatchReason, string> = {
  repeating:
    'Step back: say what is blocking you, then try a different approach, or stop and report what you found.',
  off_step:
    'Return to the step you were given and leave other work for later; mention it in your reply instead.',
  waiting:
    'Do not wait for it: finish what you can, then stop and say exactly which tool, permission or input is missing.',
  finished:
    'If your step is done, stop now and end your reply with a short summary of what you changed.',
};

export function nudgeText(reason: WatchReason, flags: RepeatFlags): string {
  return `You seemed to be ${reasonText(reason, flags)}. ${NUDGE_ADVICE[reason]}`;
}

export function withNudge(text: string, nudge: string): string {
  return `${text}\n\n## Note from the harness\n${nudge}`;
}

const ACTION_WORDS: Record<WatchAction, string> = {
  none: 'no action',
  checkpoint: 'asked you',
  nudge: 'nudge queued',
  held: 'already flagged',
};

export function watchSummary(
  name: string,
  verdict: WatchVerdict,
  action: WatchAction,
  rule: RuleVerdict,
  flags: RepeatFlags,
): string {
  const jev = verdict.noul === null ? '' : `Jev ${verdict.noul.toFixed(2)}; `;
  const ruleNote = `rule: ${rule.stuck ? 'stuck' : 'fine'}, ${rule.note}`;
  const head =
    verdict.stuck && verdict.reason
      ? `${name} looks stuck: ${reasonText(verdict.reason, flags)} · ${ACTION_WORDS[action]}`
      : `${name} looks fine`;
  return `${head} (${jev}${ruleNote})`;
}
