import type { ConversationSummary } from '@spark-outpost/contracts';
import { terminalMood } from '../terminal/native-state.ts';
import { rowState, type RowTone } from './row-state.ts';

export type BlobKind = 'working' | 'waiting' | 'done' | 'failed';

export const BLOB_LABELS: Record<BlobKind, string> = {
  working: 'Working',
  waiting: 'Waiting for you',
  done: 'Done',
  failed: 'Couldn’t finish',
};

interface Settled {
  kind: Exclude<BlobKind, 'working'>;
  since: string | null;
}

function terminalFailedSince(chat: ConversationSummary): string | null {
  const terminal = chat.terminal;
  return terminal && terminalMood(terminal.state) === 'failed' ? terminal.updatedAt : null;
}

function finishedSince(chat: ConversationSummary): string | null {
  return chat.latestRun?.finishedAt ?? null;
}

function idleTerminal(chat: ConversationSummary): Settled | null {
  if (chat.sessionType !== 'terminal') return null;
  const status = chat.latestRun?.status;
  if (status === 'succeeded') return { kind: 'done', since: finishedSince(chat) };
  if (status === 'failed') return { kind: 'failed', since: finishedSince(chat) };
  return null;
}

function settled(chat: ConversationSummary, tone: RowTone): Settled | null {
  switch (tone) {
    case 'permission':
    case 'asking':
      return { kind: 'waiting', since: chat.waitingSince ?? null };
    case 'done':
      return chat.latestRun?.needsYou
        ? { kind: 'waiting', since: finishedSince(chat) }
        : { kind: 'done', since: finishedSince(chat) };
    case 'error':
      return { kind: 'failed', since: terminalFailedSince(chat) ?? finishedSince(chat) };
    case 'idle':
      return idleTerminal(chat);
    default:
      return null;
  }
}

function after(since: string | null, seenAt: string | null): boolean {
  if (since === null) return false;
  return seenAt === null || Date.parse(since) > Date.parse(seenAt);
}

function unseen(chat: ConversationSummary, tone: RowTone): Settled | null {
  const state = settled(chat, tone);
  return state && after(state.since, chat.seenAt ?? null) ? state : null;
}

export function unseenSince(chat: ConversationSummary): string | null {
  return unseen(chat, rowState(chat, false).tone)?.since ?? null;
}

export function chatBlob(chat: ConversationSummary, open: boolean): BlobKind | null {
  if (open) return null;
  const tone = rowState(chat, false).tone;
  if (tone === 'running') return 'working';
  return unseen(chat, tone)?.kind ?? null;
}
