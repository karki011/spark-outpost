import {
  ticketItemId,
  ticketSourceNames,
  type AttentionSettings,
  type InboxTicket,
  type TicketInbox,
  type TicketSourceId,
  type TicketSourceProblem,
} from '@spark-outpost/contracts';
import { getAttentionSettings, saveAttentionSnapshot } from '../persistence/attention-settings.ts';
import type { FlaggedItem } from '../persistence/attention-settings.ts';
import { cacheTickets, setDismissedFlags, ticketRef, ticketTimes } from '../persistence/tickets.ts';
import { settledDismissals, type Thresholds, type TicketFacts } from './attention.ts';
import { connectedSources, type OpenSource } from './connections.ts';
import { factsFor, refreshLocalFacts } from './inbox-facts.ts';
import {
  forgetInbox,
  FRESH_WINDOW_MS,
  recallInbox,
  rememberInbox,
  shareSync,
  type InboxSnapshot,
} from './inbox-snapshot.ts';
import type { DevelopmentDeps } from './development.ts';
import { forgetPullStatuses } from './pull-status-cache.ts';
import { placeTicket, sortInbox } from './sections.ts';
import { isTruncated, TicketApiError } from './source.ts';
import {
  backoffUntil,
  lastGoodRead,
  recordGoodRead,
  startBackoff,
  type Backoff,
} from './source-backoff.ts';

export const DONE_RECENTLY_DAYS = 7;

export type InboxDeps = DevelopmentDeps;

export interface LoadOptions {
  refresh?: boolean;
}

export function problemOf(source: OpenSource, error: unknown): TicketSourceProblem {
  const status = error instanceof TicketApiError ? error.status : -1;
  return {
    source: source.connection.source,
    message: (error as Error).message,
    kind: status === 401 ? 'auth' : status === 0 ? 'unreachable' : 'other',
  };
}

function waitingProblem(source: TicketSourceId, { until, status }: Backoff): TicketSourceProblem {
  const time = new Date(until).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return {
    source,
    kind: 'other',
    message: `${ticketSourceNames[source]} ${status === 429 ? 'is limiting requests' : 'is unavailable'} (${status}). Spark is waiting until ${time} and shows what it last saw.`,
  };
}

async function readAssigned(open: OpenSource) {
  const [active, done] = await Promise.all([
    open.source.listAssigned({}),
    open.source.listAssigned({ status: 'done', doneWithinDays: DONE_RECENTLY_DAYS }),
  ]);
  return { tickets: [...active, ...done], truncated: isTruncated(active) || isTruncated(done) };
}

async function fetchMine(deps: InboxDeps, open: OpenSource, now: Date) {
  const source = open.connection.source;
  const rest = (backoff: Backoff) => {
    const good = lastGoodRead(deps.db, deps.workspaceId, source);
    return {
      tickets: [...(good?.tickets ?? [])],
      problem: waitingProblem(source, backoff),
      truncated: good?.truncated ?? false,
      waiting: true,
    };
  };
  const waiting = backoffUntil(deps.db, deps.workspaceId, source, now);
  if (waiting) return rest(waiting);
  try {
    const read = await readAssigned(open);
    recordGoodRead(deps.db, deps.workspaceId, source, read);
    return { ...read, problem: null, waiting: false };
  } catch (error) {
    if (error instanceof TicketApiError && error.retryAfterMs !== null) {
      const backoff = { until: now.getTime() + error.retryAfterMs, status: error.status };
      startBackoff(deps.db, deps.workspaceId, source, backoff);
      return rest(backoff);
    }
    return { tickets: [], problem: problemOf(open, error), truncated: false, waiting: false };
  }
}

const DAY_MS = 24 * 3_600_000;

function flaggedItem(ticket: InboxTicket, now: Date): FlaggedItem {
  const pull = ticket.pullRequest;
  return {
    itemId: ticketItemId(ticket.source, ticket.key),
    key: ticket.key,
    title: ticket.title,
    source: ticket.source,
    status: ticket.statusName,
    priority: ticket.priority,
    dueDate: ticket.dueDate,
    project: ticket.project,
    pullRequest: pull ? { repo: pull.repo, number: pull.number, state: pull.state } : null,
    flags: ticket.flags.map((flag) => ({
      rule: flag.rule,
      text: flag.text,
      days: flag.since ? Math.floor((now.getTime() - Date.parse(flag.since)) / DAY_MS) : null,
    })),
  };
}

async function forgetSettledDismissals(
  deps: InboxDeps,
  facts: readonly TicketFacts[],
  limits: Thresholds,
  now: Date,
): Promise<TicketFacts[]> {
  return Promise.all(
    facts.map(async (fact) => {
      const settled = settledDismissals(fact, limits, now);
      if (settled.length === 0) return fact;
      const dismissed = (fact.dismissed ?? []).filter((key) => !settled.includes(key));
      await setDismissedFlags(deps.db, deps.workspaceId, fact.ticket, dismissed);
      return { ...fact, dismissed };
    }),
  );
}

async function assembleInbox(
  deps: InboxDeps,
  snapshot: Omit<InboxSnapshot, 'at'>,
  settings: AttentionSettings,
  now: Date,
): Promise<TicketInbox> {
  const facts = await forgetSettledDismissals(deps, snapshot.facts, settings, now);
  const tickets = sortInbox(facts.map((fact) => placeTicket(fact, settings, now)));
  const flagged = tickets
    .filter((ticket) => ticket.section === 'attention')
    .map((ticket) => flaggedItem(ticket, now));
  await saveAttentionSnapshot(deps.db, deps.workspaceId, flagged);
  return {
    tickets,
    errors: snapshot.errors,
    sources: snapshot.sources,
    truncated: snapshot.truncated,
    syncedAt: snapshot.syncedAt,
    settings,
  };
}

async function syncInbox(deps: InboxDeps, now: Date, generation: number): Promise<InboxSnapshot> {
  const sources = await connectedSources(deps);
  const fetched = await Promise.all(sources.map((open) => fetchMine(deps, open, now)));
  const summaries = fetched.flatMap((result) => result.tickets);
  await cacheTickets(deps.db, deps.workspaceId, summaries, { assignedToMe: true });
  const readable = sources.filter((_, index) => !fetched[index]?.waiting);
  const snapshot: InboxSnapshot = {
    at: now.getTime(),
    generation,
    facts: await factsFor(deps, readable, summaries),
    errors: fetched.flatMap((result) => (result.problem ? [result.problem] : [])),
    sources: sources.map((open) => open.connection.source),
    truncated: sources.flatMap((open, index) =>
      fetched[index]?.truncated ? [open.connection.source] : [],
    ),
    syncedAt: now.toISOString(),
  };
  rememberInbox(deps.db, deps.workspaceId, snapshot);
  return snapshot;
}

export async function loadInbox(
  deps: InboxDeps,
  { refresh = false }: LoadOptions = {},
): Promise<TicketInbox> {
  const now = deps.now?.() ?? new Date();
  const settings = await getAttentionSettings(deps.db, deps.workspaceId);
  if (refresh) forgetPullStatuses(deps.db);
  const fresh = refresh ? null : recallInbox(deps.db, deps.workspaceId, now, FRESH_WINDOW_MS);
  if (fresh) {
    const local = await refreshLocalFacts(deps, fresh.facts);
    if (!local.pullsChanged) {
      return assembleInbox(deps, { ...fresh, facts: local.facts }, settings, now);
    }
    forgetInbox(deps.db, deps.workspaceId);
  }
  let ranOwnSync = false;
  const synced = await shareSync(deps.db, deps.workspaceId, (generation) => {
    ranOwnSync = true;
    return syncInbox(deps, now, generation);
  });
  const facts = ranOwnSync ? synced.facts : (await refreshLocalFacts(deps, synced.facts)).facts;
  return assembleInbox(deps, { ...synced, facts }, settings, now);
}

export async function reloadInboxMarks(
  deps: InboxDeps,
  changed: { source: TicketSourceId; key: string },
): Promise<TicketInbox> {
  const now = deps.now?.() ?? new Date();
  const snapshot = recallInbox(deps.db, deps.workspaceId, now);
  const known = snapshot?.facts.some(
    ({ ticket }) => ticket.source === changed.source && ticket.key === changed.key,
  );
  if (!snapshot || !known) return loadInbox(deps);
  const times = await ticketTimes(
    deps.db,
    deps.workspaceId,
    snapshot.facts.map((fact) => fact.ticket),
  );
  const facts = snapshot.facts.map((fact): TicketFacts => {
    const marks = times.get(ticketRef(fact.ticket.source, fact.ticket.key));
    return {
      ...fact,
      snooze: marks?.snooze ?? null,
      dismissed: marks?.dismissed ?? [],
      noticeSeen: marks?.noticeSeen ?? null,
    };
  });
  const settings = await getAttentionSettings(deps.db, deps.workspaceId);
  return assembleInbox(deps, { ...snapshot, facts }, settings, now);
}
