import {
  attentionLine,
  needsInput,
  terminalLabel,
  terminalWaitsAlone,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { terminalMood } from '../terminal/native-state.ts';
import type { ChatFaceState } from '../brand/chat-face.ts';
import { waitingToStart } from './waiting-to-start.ts';

export type RowTone = 'running' | 'permission' | 'asking' | 'done' | 'error' | 'idle';

export interface RowState {
  tone: RowTone;
  label: string;
  sub: string;
}

export { attentionLine, needsInput };

const IDLE: RowState = { tone: 'idle', label: '', sub: '' };

function reason(error: string | null): string {
  const text = error?.trim().replace(/\.+$/, '') ?? '';
  if (!text) return 'Stopped with an error';
  return `Stopped: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

export function isRunning(chat: ConversationSummary): boolean {
  if (chat.sessionType === 'terminal')
    return chat.terminal?.state === 'working' || chat.terminal?.state === 'starting';
  const status = chat.latestRun?.status;
  return status === 'queued' || status === 'running';
}

export function asksPermission(chat: ConversationSummary): boolean {
  return chat.attention?.kind === 'permission';
}

function waitingState(chat: ConversationSummary): RowState {
  const sub = attentionLine(chat.attention);
  if (chat.attention?.prFeedback) return { tone: 'permission', label: 'PR feedback', sub };
  if (asksPermission(chat)) return { tone: 'permission', label: 'Asking permission', sub };
  if (chat.attention?.kind === 'stuck') return { tone: 'asking', label: 'Repeating itself', sub };
  return { tone: 'asking', label: 'Needs your input', sub };
}

export function rowState(chat: ConversationSummary, open: boolean): RowState {
  if (chat.needsInput && !terminalWaitsAlone(chat)) return waitingState(chat);
  if (chat.sessionType === 'terminal' && chat.terminal) {
    const state = chat.terminal.state;
    const mood = terminalMood(state);
    const tone: RowTone =
      state === 'waiting_for_permission'
        ? 'permission'
        : mood === 'waiting'
          ? 'asking'
          : mood === 'working'
            ? 'running'
            : mood === 'failed'
              ? 'error'
              : 'idle';
    return { tone, label: terminalLabel(state), sub: terminalLabel(state) };
  }
  if (needsInput(chat)) return waitingState(chat);
  if (chat.attention?.kind === 'flag' && !isRunning(chat)) {
    return { tone: 'done', label: 'Flagged by Spark', sub: chat.attention.title };
  }
  const run = chat.latestRun;
  if (!run) return IDLE;
  switch (run.status) {
    case 'queued': {
      const waiting = waitingToStart(run.ahead);
      return { tone: 'running', label: waiting, sub: waiting };
    }
    case 'running':
      return { tone: 'running', label: 'Running', sub: run.step ?? 'Working' };
    case 'failed':
      return { tone: 'error', label: 'Stopped with an error', sub: reason(run.error) };
    case 'outcome_unknown':
      return run.interruptionChoice === 'fresh'
        ? IDLE
        : { tone: 'error', label: 'Interrupted', sub: 'Interrupted: continue or start fresh' };
    case 'succeeded':
      if (!chat.unread || open) return IDLE;
      return run.needsYou
        ? { tone: 'done', label: 'Finished, needs you', sub: run.needsYou }
        : { tone: 'done', label: 'Finished, not opened yet', sub: 'Finished · open to review' };
    default:
      return IDLE;
  }
}

const FACE_STATES: Record<RowTone, ChatFaceState> = {
  running: 'working',
  permission: 'needs_you',
  asking: 'needs_you',
  done: 'done',
  error: 'failed',
  idle: 'idle',
};

export function rowFaceState(chat: ConversationSummary, tone: RowTone): ChatFaceState {
  if (tone === 'idle' && chat.archivedAt) return 'archived';
  if (tone === 'done' && chat.latestRun?.needsYou) return 'needs_you';
  return FACE_STATES[tone];
}

export interface Attention {
  count: number;
  others: ConversationSummary[];
  text: string | null;
}

export function waitingHeadline(chat: ConversationSummary): string {
  return `${chat.title} ${asksPermission(chat) ? 'needs your permission' : 'needs your input'}`;
}

export function attention(
  chats: readonly ConversationSummary[],
  openId: string | null,
  alerting: ReadonlySet<string>,
): Attention {
  const asking = chats.filter((chat) => !chat.archivedAt && alerting.has(chat.id));
  const others = asking.filter((chat) => chat.id !== openId);
  const text =
    others.length === 0
      ? null
      : others.length === 1
        ? waitingHeadline(others[0]!)
        : `${others.length} chats need you`;
  return { count: asking.length, others, text };
}
