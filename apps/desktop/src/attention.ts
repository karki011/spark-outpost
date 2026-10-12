export interface AttentionRequest {
  key: string;
  chatId: string;
  title: string;
  body: string;
}

export interface AttentionReport {
  count: number;
  requests: AttentionRequest[];
}

export const NO_ATTENTION: AttentionReport = { count: 0, requests: [] };

const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REQUESTS = 50;
const MAX_COUNT = 9_999;
const MAX_KEY = 120;
const MAX_TITLE = 120;
const MAX_BODY = 200;

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function parseRequest(value: unknown): AttentionRequest | null {
  if (!value || typeof value !== 'object') return null;
  const { key, chatId, title, body } = value as Record<string, unknown>;
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY) return null;
  if (typeof chatId !== 'string' || !CHAT_ID.test(chatId)) return null;
  if (typeof title !== 'string' || typeof body !== 'string') return null;
  const shown = clip(title, MAX_TITLE);
  if (!shown) return null;
  return { key, chatId, title: shown, body: clip(body, MAX_BODY) };
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
}

export interface AttentionDecision {
  seen: Set<string>;
  notify: AttentionRequest[];
}

export function decideAttention(context: AttentionContext): AttentionDecision {
  const seen = new Set<string>();
  const fresh: AttentionRequest[] = [];
  for (const request of context.report.requests) {
    if (seen.has(request.key)) continue;
    seen.add(request.key);
    if (!context.seen.has(request.key)) fresh.push(request);
  }
  const quiet = !context.enabled || context.islandShowing || context.sparkFocused;
  return { seen, notify: quiet ? [] : fresh };
}
