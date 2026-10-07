import type {
  PullRequestStatus,
  TicketDetail,
  TicketDevelopment,
  TicketListItem,
  TicketRef,
  TicketWork,
} from '@spark-outpost/contracts';
import { ticketRef } from '../persistence/tickets.ts';
import type { GitHubDeps } from '../ship/github/access.ts';
import type { OpenSource, TicketDeps } from './connections.ts';
import { sourceDevelopment, type DevelopmentRead } from './development-cache.ts';
import {
  attentionPull,
  finishPulls,
  mergePulls,
  pullsToRead,
  refPull,
} from './development-merge.ts';
import { myGitHubLogins, projectOpenPulls, pullsMatchingKey } from './github-pulls.ts';
import { parsePullUrl, readPullStatuses } from './pull-status.ts';
import type { SourcePull } from './source.ts';

export interface DevelopmentDeps extends TicketDeps {
  github: GitHubDeps;
  now?: () => Date;
}

export interface TicketDev {
  development: TicketDevelopment | undefined;
  pull: PullRequestStatus | null;
  mine: boolean;
}

interface Subject {
  ref: string;
  key: string;
  spark: TicketRef[];
  read: DevelopmentRead | undefined;
  linked: SourcePull[];
}

const INBOX_READS = 2;
const VIEW_READS = 6;
const VIEW_MAX_AGE_MS = 60_000;
const NOTHING: TicketDev = { development: undefined, pull: null, mine: true };

const sparkPulls = (work: readonly TicketWork[]) => work.flatMap((entry) => entry.pullRequests);

function linkedPulls(subject: Subject): SourcePull[] {
  const read = subject.read;
  return [...(read && read !== 'unavailable' ? read.pullRequests : []), ...subject.linked];
}

function developmentOf(subject: Subject, pullRequests: TicketDevelopment['pullRequests']) {
  const read = subject.read;
  const known = read && read !== 'unavailable' ? read : null;
  const development: TicketDevelopment = {
    availability: read === 'unavailable' ? 'unavailable' : 'ok',
    pullRequests,
    branches: known?.branches ?? [],
    commits: known?.commits ?? null,
    builds: known?.builds ?? null,
  };
  const empty =
    development.availability === 'ok' &&
    pullRequests.length === 0 &&
    development.branches.length === 0 &&
    !development.commits &&
    !development.builds;
  return empty ? undefined : development;
}

async function resolve(
  deps: DevelopmentDeps,
  subjects: readonly Subject[],
  readLimit: number,
): Promise<Map<string, TicketDev>> {
  const unlinked = (subject: Subject) =>
    subject.spark.length === 0 && linkedPulls(subject).length === 0;
  const open = subjects.some(unlinked) ? await projectOpenPulls(deps.github).catch(() => []) : [];
  const merged = subjects.map((subject) =>
    mergePulls(
      subject.spark,
      linkedPulls(subject),
      unlinked(subject) ? pullsMatchingKey(subject.key, open) : [],
    ),
  );
  const latest = subjects.map((subject) => subject.spark.at(-1)?.url ?? null);
  const urls = merged.flatMap((pulls, index) => pullsToRead(pulls, latest[index]!, readLimit));
  const statuses = await readPullStatuses(deps.github, urls);
  const others = merged.some((pulls) => pulls.some((pull) => pull.origin !== 'spark'));
  const logins = others ? await myGitHubLogins(deps.github) : new Set<string>();
  return new Map(
    subjects.map((subject, index) => {
      const pulls = finishPulls(merged[index]!, statuses, logins);
      const chosen = attentionPull(pulls, latest[index]!);
      return [subject.ref, { development: developmentOf(subject, pulls), ...chosen }] as const;
    }),
  );
}

async function readSource(
  deps: DevelopmentDeps,
  open: OpenSource,
  keys: readonly string[],
  maxAgeMs?: number,
): Promise<Map<string, DevelopmentRead>> {
  const now = deps.now?.() ?? new Date();
  return sourceDevelopment(deps, open, keys, now, maxAgeMs).catch(() => new Map());
}

export async function inboxDevelopment(
  deps: DevelopmentDeps,
  sources: readonly OpenSource[],
  tickets: readonly TicketListItem[],
): Promise<(ticket: TicketListItem) => TicketDev> {
  const reads = new Map<string, DevelopmentRead>();
  await Promise.all(
    sources.map(async (open) => {
      const source = open.connection.source;
      const keys = tickets
        .filter((ticket) => ticket.source === source && ticket.status !== 'done')
        .map((ticket) => ticket.key);
      for (const [key, read] of await readSource(deps, open, keys)) {
        reads.set(ticketRef(source, key), read);
      }
    }),
  );
  const resolved = await resolve(
    deps,
    tickets.map((ticket) => {
      const ref = ticketRef(ticket.source, ticket.key);
      return {
        ref,
        key: ticket.key,
        spark: sparkPulls(ticket.work),
        read: reads.get(ref),
        linked: [],
      };
    }),
    INBOX_READS,
  );
  return (ticket) => resolved.get(ticketRef(ticket.source, ticket.key)) ?? NOTHING;
}

export async function viewDevelopment(
  deps: DevelopmentDeps,
  open: OpenSource,
  ticket: TicketDetail,
  work: readonly TicketWork[],
): Promise<TicketDevelopment | undefined> {
  const ref = ticketRef(ticket.source, ticket.key);
  const read = (await readSource(deps, open, [ticket.key], VIEW_MAX_AGE_MS)).get(ticket.key);
  const subject: Subject = {
    ref,
    key: ticket.key,
    spark: sparkPulls(work),
    read,
    linked: ticket.links.filter((link) => parsePullUrl(link.url) !== null).map(refPull),
  };
  return (await resolve(deps, [subject], VIEW_READS)).get(ref)?.development;
}
