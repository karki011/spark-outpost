import type { TicketSourceId } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { listTicketConnections } from '../persistence/ticket-connections.ts';
import { cacheTickets, type CachedTicket } from '../persistence/tickets.ts';
import { connectedSources, type OpenSource, type TicketDeps } from './connections.ts';
import { ticketMentions, type TicketMention } from './mentions.ts';

export interface MentionCacheDeps extends TicketDeps {
  lookupMs?: number;
}

export interface KnownMention {
  mention: TicketMention;
  ticket: CachedTicket;
}

interface Connected {
  source: TicketSourceId;
  apiUrl: string;
}

const LOOKUP_MS = 3_000;
const MISS_TTL_MS = 2 * 60_000;
const misses = new Map<string, number>();

function fromSources<T extends Connected>(sources: readonly T[], mention: TicketMention): T[] {
  if (!mention.source) return [...sources];
  return sources.filter(
    (entry) =>
      entry.source === mention.source &&
      (mention.site === null || entry.apiUrl.toLowerCase() === mention.site),
  );
}

async function cachedTicket(
  db: Queryable,
  workspaceId: string,
  sources: readonly TicketSourceId[],
  key: string,
): Promise<CachedTicket | null> {
  if (sources.length === 0) return null;
  const { rows } = await db.query<{
    source: TicketSourceId;
    key: string;
    title: string;
    status: CachedTicket['status'];
    status_name: string;
    url: string;
  }>(
    `SELECT source, key, title, status, status_name, url FROM tickets
     WHERE workspace_id = $1 AND key = $2 AND source = ANY($3::text[])
     ORDER BY cached_at DESC LIMIT 1`,
    [workspaceId, key, sources],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    source: row.source,
    key: row.key,
    title: row.title,
    status: row.status,
    statusName: row.status_name,
    url: row.url,
  };
}

export async function knownMentions(
  db: Queryable,
  workspaceId: string,
  text: string,
): Promise<KnownMention[]> {
  const mentions = ticketMentions(text);
  if (mentions.length === 0) return [];
  const connected = await listTicketConnections(db, workspaceId);
  const known: KnownMention[] = [];
  for (const mention of mentions) {
    const sources = fromSources(connected, mention).map((entry) => entry.source);
    const ticket = await cachedTicket(db, workspaceId, sources, mention.key);
    if (ticket) known.push({ mention, ticket });
  }
  return known;
}

function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise.catch(() => null), timeout]).finally(() => clearTimeout(timer));
}

async function fetchInto(deps: MentionCacheDeps, sources: readonly OpenSource[], key: string) {
  for (const open of sources) {
    const missKey = `${deps.workspaceId}:${open.connection.source}:${key}`;
    if ((misses.get(missKey) ?? 0) > Date.now()) continue;
    const summary = await within(open.source.getSummary(key), deps.lookupMs ?? LOOKUP_MS);
    if (!summary) {
      misses.set(missKey, Date.now() + MISS_TTL_MS);
      continue;
    }
    await cacheTickets(deps.db, deps.workspaceId, [summary]);
    return;
  }
}

export async function warmMentionedTickets(deps: MentionCacheDeps, text: string): Promise<void> {
  const mentions = ticketMentions(text);
  if (mentions.length === 0) return;
  const open = await connectedSources(deps);
  const connected = open.map((entry) => ({
    source: entry.connection.source,
    apiUrl: entry.connection.apiUrl,
    open: entry,
  }));
  for (const mention of mentions) {
    const sources = fromSources(connected, mention);
    const cached = await cachedTicket(
      deps.db,
      deps.workspaceId,
      sources.map((entry) => entry.source),
      mention.key,
    );
    if (!cached)
      await fetchInto(
        deps,
        sources.map((entry) => entry.open),
        mention.key,
      );
  }
}
