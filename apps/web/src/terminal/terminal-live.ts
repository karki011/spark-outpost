import {
  TERMINAL_LIVE_MAX_CHATS,
  terminalLiveSchema,
  type TerminalLive,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

const MERGE_WINDOW_MS = 40;

export type ChatTerminalLive = TerminalLive[string];

interface Waiter {
  resolve: (live: ChatTerminalLive) => void;
  reject: (error: unknown) => void;
}

const waiting = new Map<string, Waiter[]>();
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule(): void {
  timer ??= setTimeout(flush, MERGE_WINDOW_MS);
}

function flush(): void {
  timer = undefined;
  const chats = [...waiting.keys()].slice(0, TERMINAL_LIVE_MAX_CHATS);
  const batch = chats.map((chat) => [chat, waiting.get(chat)!] as const);
  for (const chat of chats) waiting.delete(chat);
  if (waiting.size > 0) schedule();
  request(terminalLiveSchema, `/terminal-live?chats=${chats.join(',')}`).then(
    (live) => {
      for (const [chat, waiters] of batch) {
        for (const waiter of waiters) waiter.resolve(live[chat] ?? {});
      }
    },
    (error: unknown) => {
      for (const [, waiters] of batch) for (const waiter of waiters) waiter.reject(error);
    },
  );
}

export function loadTerminalLive(chat: string): Promise<ChatTerminalLive> {
  return new Promise((resolve, reject) => {
    waiting.set(chat, [...(waiting.get(chat) ?? []), { resolve, reject }]);
    schedule();
  });
}

export function sessionOf(live: ChatTerminalLive) {
  if (live.session === undefined) throw new Error('Could not read this Terminal session.');
  return live.session;
}

export function usageOf(live: ChatTerminalLive) {
  if (!live.usage) throw new Error('Could not read this Terminal session’s usage.');
  return live.usage;
}
