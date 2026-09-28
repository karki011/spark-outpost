import type { ConversationSummary, PlanProgress } from '@spark-outpost/contracts';
import type { BlobExpression } from '../brand/blob-expression.ts';
import { isRunning, needsInput, rowState } from '../conversations/row-state.ts';
import { countLabel } from '../ui/count-label.ts';

export function greeting(hour: number): string {
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? '';
}

interface SummaryPart {
  text: string;
  strong: boolean;
}

export function summaryParts(chats: readonly ConversationSummary[]): SummaryPart[] {
  const active = chats.filter((chat) => !chat.archivedAt);
  const working = active.filter((chat) => isRunning(chat) && !needsInput(chat)).length;
  const asking = active.filter(needsInput).length;
  const bits = [
    working > 0 ? countLabel(working, 'agent is working', 'agents are working') : null,
    asking > 0 ? countLabel(asking, 'chat needs your input', 'chats need your input') : null,
  ].filter((bit): bit is string => bit !== null);
  if (bits.length === 0) return [{ text: 'All quiet. Start something new below.', strong: false }];
  const parts = bits.flatMap((bit, index) => [
    ...(index > 0 ? [{ text: ' and ', strong: false }] : []),
    { text: bit, strong: true },
  ]);
  return [...parts, { text: '.', strong: false }];
}

type NeedTone = 'asking' | 'error' | 'done';

export interface NeedItem {
  chat: ConversationSummary;
  tone: NeedTone;
  sub: string;
  action: string;
  provider: string | null;
  expression: BlobExpression;
}

const NEED_RANK: Record<NeedTone, number> = { asking: 0, error: 1, done: 2 };
const NEED_ACTION: Record<NeedTone, string> = {
  asking: 'Answer',
  error: 'See error',
  done: 'Review',
};
const NEED_EXPRESSION: Record<NeedTone, BlobExpression> = {
  asking: 'unsure',
  error: 'sad',
  done: 'happy',
};

function needTone(chat: ConversationSummary): NeedTone | null {
  const tone = rowState(chat, false).tone;
  if (tone === 'asking' || tone === 'permission') return 'asking';
  if (tone === 'error' || tone === 'done') return tone;
  return null;
}

function chatProvider(chat: ConversationSummary): string | null {
  return chat.attention?.provider ?? chat.latestRun?.provider ?? null;
}

export function needsYou(chats: readonly ConversationSummary[]): NeedItem[] {
  return chats
    .filter((chat) => !chat.archivedAt)
    .flatMap((chat): NeedItem[] => {
      const tone = needTone(chat);
      if (!tone) return [];
      return [
        {
          chat,
          tone,
          sub: rowState(chat, false).sub,
          action: NEED_ACTION[tone],
          provider: chatProvider(chat),
          expression: NEED_EXPRESSION[tone],
        },
      ];
    })
    .sort((a, b) => NEED_RANK[a.tone] - NEED_RANK[b.tone]);
}

const MIN_PROGRESS = 4;

export function progressPercent(progress: PlanProgress | null): number | null {
  if (!progress || progress.total <= 0) return null;
  const steps = progress.done + (progress.active > 0 ? 0.5 : 0);
  const percent = Math.round((steps / progress.total) * 100);
  return Math.min(100, Math.max(MIN_PROGRESS, percent));
}

export interface RunItem {
  chat: ConversationSummary;
  step: string;
  provider: string | null;
  percent: number | null;
}

export function runningNow(chats: readonly ConversationSummary[]): RunItem[] {
  return chats
    .filter((chat) => !chat.archivedAt && isRunning(chat) && !needsInput(chat))
    .map((chat) => ({
      chat,
      step: rowState(chat, false).sub,
      provider: chatProvider(chat),
      percent: progressPercent(chat.latestRun?.progress ?? null),
    }));
}

const RECENT_LIMIT = 5;

export function recentChats(
  chats: readonly ConversationSummary[],
  shown: readonly ConversationSummary[],
): ConversationSummary[] {
  const seen = new Set(shown.map((chat) => chat.id));
  return chats
    .filter((chat) => !chat.archivedAt && !seen.has(chat.id))
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, RECENT_LIMIT);
}
