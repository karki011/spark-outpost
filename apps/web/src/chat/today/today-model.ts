import type { TodayChat, TodayChatState, TodaySummary } from '@spark-outpost/contracts';
import type { BlobExpression } from '../../brand/blob-expression.ts';
import { formatCost } from '../../usage/format.ts';

export interface TodayStat {
  key: string;
  count: string;
  label: string;
  attention?: boolean;
}

function counted(count: number, one: string, many: string): { count: string; label: string } {
  return { count: String(count), label: count === 1 ? one : many };
}

export function todayStats(summary: TodaySummary): TodayStat[] {
  const stats: TodayStat[] = [{ key: 'chats', ...counted(summary.chats, 'chat', 'chats') }];
  if (summary.waiting > 0) {
    stats.push({
      key: 'waiting',
      count: String(summary.waiting),
      label: 'need you',
      attention: true,
    });
  }
  if (summary.kept > 0) {
    stats.push({ key: 'kept', ...counted(summary.kept, 'change kept', 'changes kept') });
  }
  if (summary.prs > 0) stats.push({ key: 'prs', ...counted(summary.prs, 'PR', 'PRs') });
  if (summary.tickets > 0) {
    stats.push({ key: 'tickets', ...counted(summary.tickets, 'ticket', 'tickets') });
  }
  if (summary.costUsd !== null && summary.costUsd > 0) {
    stats.push({
      key: 'spend',
      count: formatCost(summary.costUsd, summary.costSource),
      label: 'spent',
    });
  }
  return stats;
}

const STATE_LABEL: Record<TodayChatState, string | null> = {
  waiting: 'Needs you',
  running: 'Working',
  failed: 'Failed',
  stalled: 'Stopped',
  finished: null,
  idle: null,
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function chatNote(chat: TodayChat): string {
  const wins = [
    chat.kept > 0 ? `${chat.kept} kept` : null,
    chat.prs > 0 ? plural(chat.prs, 'PR', 'PRs') : null,
    chat.tickets > 0 ? plural(chat.tickets, 'ticket', 'tickets') : null,
  ];
  const parts = [STATE_LABEL[chat.state], ...wins].filter((part): part is string => part !== null);
  if (parts.length === 0) return chat.project ?? 'Done';
  return parts.join(' · ');
}

const STATE_EXPRESSION: Record<TodayChatState, BlobExpression> = {
  waiting: 'unsure',
  running: 'thinking',
  failed: 'sad',
  stalled: 'sleepy',
  finished: 'happy',
  idle: 'idle',
};

export function chatExpression(state: TodayChatState): BlobExpression {
  return STATE_EXPRESSION[state];
}
