import type { BrowserNetworkEntry } from '@spark-outpost/contracts';

export interface NetworkQuery {
  method?: string | undefined;
  filter?: string | undefined;
  status?: string | undefined;
  type?: string | undefined;
  since?: number | undefined;
  limit: number;
}

export interface NetworkView {
  lines: string[];
  matched: number;
  hiddenPreflight: number;
  maxInFlight: number;
  pending: number;
}

interface StatusRange {
  min: number;
  max: number;
}

const ANY_METHOD = 'ANY';

export function statusRange(text: string): StatusRange | null {
  const value = text.trim().toLowerCase();
  const family = /^([1-5])xx$/.exec(value);
  if (family) return { min: Number(family[1]) * 100, max: Number(family[1]) * 100 + 99 };
  const range = /^(\d{3})\s*-\s*(\d{3})$/.exec(value);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const single = /^(\d{3})$/.exec(value);
  if (single) return { min: Number(single[1]), max: Number(single[1]) };
  return null;
}

function isPreflight(entry: BrowserNetworkEntry): boolean {
  return entry.method === 'OPTIONS' || entry.type?.toLowerCase() === 'preflight';
}

function showsPreflight(method: string | undefined): boolean {
  const asked = method?.toUpperCase();
  return asked === 'OPTIONS' || asked === ANY_METHOD;
}

function methodMatches(entry: BrowserNetworkEntry, method: string | undefined): boolean {
  const asked = method?.toUpperCase();
  return asked === undefined || asked === ANY_METHOD || entry.method.toUpperCase() === asked;
}

function statusMatches(entry: BrowserNetworkEntry, range: StatusRange | null): boolean {
  if (range === null) return true;
  return entry.status !== null && entry.status >= range.min && entry.status <= range.max;
}

export function maxInFlight(entries: readonly BrowserNetworkEntry[]): number {
  const edges = entries.flatMap((entry) => [
    { at: entry.startMs, step: 1 },
    { at: entry.endMs ?? Number.POSITIVE_INFINITY, step: -1 },
  ]);
  edges.sort((a, b) => a.at - b.at || a.step - b.step);
  let open = 0;
  let most = 0;
  for (const edge of edges) {
    open += edge.step;
    most = Math.max(most, open);
  }
  return most;
}

function ms(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}ms`;
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} kB`;
}

function timing(entry: BrowserNetworkEntry): string {
  if (entry.endMs === null) return `+${ms(entry.startMs)} → pending`;
  const took = Math.round((entry.endMs - entry.startMs) * 10) / 10;
  return `+${ms(entry.startMs)} → +${ms(entry.endMs)} (${ms(took)})`;
}

function sizes(entry: BrowserNetworkEntry): string | null {
  if (entry.encodedBytes === null && entry.decodedBytes === null) return null;
  const sent = entry.encodedBytes === null ? '?' : size(entry.encodedBytes);
  const body = entry.decodedBytes === null ? null : size(entry.decodedBytes);
  return body === null ? sent : `${sent} (body ${body})`;
}

export function networkLine(entry: BrowserNetworkEntry): string {
  const status = entry.failed ? `failed: ${entry.failed}` : String(entry.status ?? '…');
  const parts = [
    timing(entry),
    entry.method,
    status,
    entry.type ?? 'other',
    entry.url,
    sizes(entry),
    entry.fromCache ? 'from cache' : null,
    entry.initiator ? `by ${entry.initiator}` : null,
  ];
  return parts.filter((part) => part !== null).join(' · ');
}

export function viewNetwork(
  entries: readonly BrowserNetworkEntry[],
  query: NetworkQuery,
): NetworkView {
  const range = query.status === undefined ? null : statusRange(query.status);
  const needle = query.filter?.toLowerCase();
  const type = query.type?.toLowerCase();
  const sorted = [...entries].sort((a, b) => a.startMs - b.startMs);
  const preflights = new Set(showsPreflight(query.method) ? [] : sorted.filter(isPreflight));
  const matching = sorted.filter(
    (entry) =>
      !preflights.has(entry) &&
      methodMatches(entry, query.method) &&
      statusMatches(entry, range) &&
      (type === undefined || entry.type?.toLowerCase() === type) &&
      (query.since === undefined || entry.startMs >= query.since) &&
      (needle === undefined || entry.url.toLowerCase().includes(needle)),
  );
  const shown = matching.slice(-query.limit);
  return {
    lines: shown.map(networkLine),
    matched: matching.length,
    hiddenPreflight: preflights.size,
    maxInFlight: maxInFlight(shown),
    pending: shown.filter((entry) => entry.endMs === null).length,
  };
}
