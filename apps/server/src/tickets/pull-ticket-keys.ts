import type { Queryable } from '../persistence/db.ts';
import { cachedTicketsNamed, type KnownTicket } from '../persistence/pull-ticket-sync.ts';
import type { OpenSource } from './connections.ts';

const KEY_IN_TEXT = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9_]*-\d+)(?![A-Za-z0-9])/g;
const MAX_KEYS = 5;
const SOURCES_WITH_KEYS = new Set(['jira', 'linear']);

const writtenAsKey = (key: string) => key === key.toUpperCase();

export function keysIn(...texts: readonly (string | null)[]): string[] {
  const seen = new Map<string, string>();
  for (const text of texts) {
    for (const match of (text ?? '').matchAll(KEY_IN_TEXT)) {
      const key = match[1]!;
      const known = seen.get(key.toUpperCase());
      if (!known || (!writtenAsKey(known) && writtenAsKey(key))) seen.set(key.toUpperCase(), key);
    }
  }
  return [...seen.values()].slice(0, MAX_KEYS);
}

export const sameTicket = (a: KnownTicket, b: KnownTicket) =>
  a.source === b.source && a.key.toUpperCase() === b.key.toUpperCase();

async function lookedUp(sources: readonly OpenSource[], key: string): Promise<KnownTicket | null> {
  for (const open of sources) {
    if (!SOURCES_WITH_KEYS.has(open.connection.source)) continue;
    const found = await open.source.getSummary(key).catch(() => null);
    if (found) return { source: open.connection.source, key: found.key };
  }
  return null;
}

export async function ticketsNamedIn(
  db: Queryable,
  workspaceId: string,
  sources: readonly OpenSource[],
  texts: readonly (string | null)[],
): Promise<KnownTicket[]> {
  const keys = keysIn(...texts);
  const connected = new Set(sources.map((open) => open.connection.source));
  const cached = (await cachedTicketsNamed(db, workspaceId, keys)).filter(
    (ticket) => connected.has(ticket.source) && SOURCES_WITH_KEYS.has(ticket.source),
  );
  const found = [...cached];
  for (const key of keys) {
    const known = cached.some((ticket) => ticket.key.toUpperCase() === key.toUpperCase());
    if (known || !writtenAsKey(key)) continue;
    const ticket = await lookedUp(sources, key);
    if (ticket) found.push(ticket);
  }
  return found;
}
