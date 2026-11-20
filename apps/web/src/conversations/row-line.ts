import type { ConversationSummary } from '@spark-outpost/contracts';
import { clock } from '../calendar/calendar-format.ts';
import { terminalMood } from '../terminal/native-state.ts';
import { activeLabel, recencyLabel } from './recency.ts';
import type { RowState } from './row-state.ts';

export type RowLine =
  | { kind: 'doing'; text: string }
  | { kind: 'waiting'; since: number }
  | { kind: 'finished'; at: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const GENERIC_STEPS = new Set(['Working']);

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

function waitingSince(chat: ConversationSummary): number | null {
  const terminal = chat.terminal;
  if (chat.sessionType === 'terminal' && terminal && terminalMood(terminal.state) === 'waiting') {
    return timeOf(terminal.updatedAt);
  }
  return timeOf(chat.waitingSince);
}

function finishedUnread(chat: ConversationSummary): boolean {
  if (chat.attention?.kind === 'flag' || chat.shellAlert) return false;
  return chat.unread && chat.latestRun?.status === 'succeeded';
}

export function rowLine(chat: ConversationSummary, state: RowState): RowLine | null {
  switch (state.tone) {
    case 'running': {
      if (chat.sessionType === 'terminal') return null;
      const run = chat.latestRun;
      const text = run && !run.waitingOn && run.doing ? run.doing : state.sub;
      if (!text || GENERIC_STEPS.has(text)) return null;
      return { kind: 'doing', text };
    }
    case 'permission':
    case 'asking': {
      const since = waitingSince(chat);
      return since === null ? null : { kind: 'waiting', since };
    }
    case 'done': {
      if (!finishedUnread(chat)) return null;
      const at = timeOf(chat.latestRun?.finishedAt);
      return at === null ? null : { kind: 'finished', at };
    }
    default:
      return null;
  }
}

export function waitingAge(since: number, now: number): string {
  const elapsed = Math.max(0, now - since);
  if (elapsed < MINUTE) return 'Waiting under a minute';
  if (elapsed < HOUR) return `Waiting ${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) {
    const minutes = Math.floor((elapsed % HOUR) / MINUTE);
    const hours = `${Math.floor(elapsed / HOUR)}h`;
    return minutes === 0 ? `Waiting ${hours}` : `Waiting ${hours} ${minutes}m`;
  }
  return `Waiting ${Math.floor(elapsed / DAY)}d`;
}

export function finishedAt(at: number, now: number): string {
  const iso = new Date(at).toISOString();
  const day = recencyLabel(iso, now);
  if (day === 'Today') return `Finished ${clock(at)}`;
  if (day === 'Yesterday') return `Finished yesterday, ${clock(at)}`;
  return `Finished ${activeLabel(iso, now)}`;
}
