import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import {
  API_TOKEN_HEADER,
  attentionReport,
  conversationSummarySchema,
  parseAppEvent,
  type AppEventKind,
  type AttentionReport,
  type ConversationSummary,
} from '@spark-outpost/contracts';

const RECONNECT_MS = 2_000;
const LIST_TIMEOUT_MS = 10_000;
const LIST_KINDS: readonly AppEventKind[] = [
  'conversation',
  'run',
  'approval',
  'task',
  'outpost_changed',
];
const chatListSchema = z.array(conversationSummarySchema);

export interface EventFrames {
  data: string[];
  rest: string;
}

export function eventFrames(buffer: string): EventFrames {
  const frames = buffer.split(/\r?\n\r?\n/);
  const rest = frames.pop() ?? '';
  const data = frames.flatMap((frame) => {
    const lines = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    return lines.length > 0 ? [lines.join('\n')] : [];
  });
  return { data, rest };
}

export function changesChatList(data: string): boolean {
  const event = parseAppEvent(data);
  return event !== null && LIST_KINDS.includes(event.kind);
}

export interface AttentionFeedOptions {
  origin: string;
  token: string;
  onReport: (report: AttentionReport) => void;
  fetchImpl?: typeof fetch;
  reconnectMs?: number;
}

export interface AttentionFeed {
  stop(): void;
}

export function startAttentionFeed(options: AttentionFeedOptions): AttentionFeed {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = { [API_TOKEN_HEADER]: options.token };
  const stopped = new AbortController();
  let loading = false;
  let stale = false;
  let reported: string | null = null;

  const chatList = async (): Promise<ConversationSummary[] | null> => {
    try {
      const response = await fetchImpl(`${options.origin}/api/conversations`, {
        headers,
        signal: AbortSignal.any([stopped.signal, AbortSignal.timeout(LIST_TIMEOUT_MS)]),
      });
      if (!response.ok) return null;
      const parsed = chatListSchema.safeParse(await response.json());
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };

  const reportChanged = (report: AttentionReport) => {
    const next = JSON.stringify(report);
    if (next === reported) return;
    reported = next;
    options.onReport(report);
  };

  const load = async () => {
    if (loading) {
      stale = true;
      return;
    }
    loading = true;
    do {
      stale = false;
      const chats = await chatList();
      if (stopped.signal.aborted) return;
      if (chats) reportChanged(attentionReport(chats));
    } while (stale);
    loading = false;
  };

  const follow = async () => {
    const response = await fetchImpl(`${options.origin}/api/events`, {
      headers,
      signal: stopped.signal,
    });
    if (!response.ok || !response.body) return;
    void load();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      const frames = eventFrames(buffer + decoder.decode(chunk.value, { stream: true }));
      buffer = frames.rest;
      if (frames.data.some(changesChatList)) void load();
    }
  };

  const run = async () => {
    while (!stopped.signal.aborted) {
      await follow().catch(() => undefined);
      await delay(options.reconnectMs ?? RECONNECT_MS, undefined, {
        signal: stopped.signal,
      }).catch(() => undefined);
    }
  };
  void run();

  return { stop: () => stopped.abort() };
}
