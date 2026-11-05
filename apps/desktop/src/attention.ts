import type { AttentionReport, AttentionRequest } from '@spark-outpost/contracts';

export const NO_ATTENTION: AttentionReport = { count: 0, requests: [] };

const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REQUESTS = 50;
const MAX_COUNT = 9_999;
const MAX_KEY = 120;
const MAX_CHAT = 80;
const MAX_TITLE = 120;
const MAX_BODY = 200;

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function parseRequest(value: unknown): AttentionRequest | null {
  if (!value || typeof value !== 'object') return null;
  const { key, chatId, chat, title, body } = value as Record<string, unknown>;
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY) return null;
  if (typeof chatId !== 'string' || !CHAT_ID.test(chatId)) return null;
  if (typeof chat !== 'string' || typeof title !== 'string' || typeof body !== 'string') {
    return null;
  }
  const shown = clip(title, MAX_TITLE);
  if (!shown) return null;
  return { key, chatId, chat: clip(chat, MAX_CHAT), title: shown, body: clip(body, MAX_BODY) };
}

export function parseAttentionReport(value: unknown): AttentionReport | null {
  if (!value || typeof value !== 'object') return null;
  const { count, requests } = value as Record<string, unknown>;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return null;
  if (!Array.isArray(requests)) return null;
  const parsed = requests.slice(0, MAX_REQUESTS).map(parseRequest);
  if (parsed.some((request) => request === null)) return null;
  return { count: Math.min(count, MAX_COUNT), requests: parsed as AttentionRequest[] };
}

export function dockBadge(channelBadge: string | null, count: number, enabled: boolean): string {
  const waiting = enabled && count > 0 ? String(count) : '';
  return [channelBadge, waiting].filter(Boolean).join(' ');
}

export interface AttentionContext {
  report: AttentionReport;
  seen: ReadonlySet<string>;
  enabled: boolean;
  islandShowing: boolean;
  sparkFocused: boolean;
  viewed: ReadonlySet<string>;
}

export interface AttentionNotice {
  key: string;
  chatId: string | null;
  title: string;
  body: string;
  requests: string[];
  chats: string[];
}

function summaryBody(firsts: readonly AttentionRequest[]): string {
  const [first, second] = firsts.map((request) => request.chat);
  const more = firsts.length - 2;
  const text = more > 0 ? `${first}, ${second} and ${more} more` : `${first} and ${second}`;
  return clip(text, MAX_BODY);
}

function firstPerChat(fresh: readonly AttentionRequest[]): AttentionRequest[] {
  const byChat = new Map<string, AttentionRequest>();
  for (const request of fresh) {
    if (!byChat.has(request.chatId)) byChat.set(request.chatId, request);
  }
  return [...byChat.values()];
}

export function noticesFor(fresh: readonly AttentionRequest[]): AttentionNotice[] {
  const firsts = firstPerChat(fresh);
  const requests = fresh.map((request) => request.key);
  if (firsts.length === 0) return [];
  if (firsts.length === 1) {
    const request = firsts[0]!;
    return [
      {
        key: request.key,
        chatId: request.chatId,
        title: request.title,
        body: request.body,
        requests,
        chats: [request.chatId],
      },
    ];
  }
  return [
    {
      key: `summary:${firsts[0]!.key}`,
      chatId: null,
      title: `${firsts.length} chats need you`,
      body: summaryBody(firsts),
      requests,
      chats: firsts.map((request) => request.chatId),
    },
  ];
}

export function withdrawn(notice: AttentionNotice, waiting: ReadonlySet<string>): boolean {
  return !notice.requests.some((key) => waiting.has(key));
}

export function seenInSpark(notice: AttentionNotice, viewed: ReadonlySet<string>): boolean {
  return notice.chats.every((chatId) => viewed.has(chatId));
}

export interface AttentionDecision {
  seen: Set<string>;
  notify: AttentionNotice[];
}

export function decideAttention(context: AttentionContext): AttentionDecision {
  const seen = new Set<string>();
  const fresh: AttentionRequest[] = [];
  for (const request of context.report.requests) {
    if (seen.has(request.key)) continue;
    seen.add(request.key);
    if (!context.seen.has(request.key) && !context.viewed.has(request.chatId)) fresh.push(request);
  }
  const quiet = !context.enabled || context.islandShowing || context.sparkFocused;
  return { seen, notify: quiet ? [] : noticesFor(fresh) };
}
