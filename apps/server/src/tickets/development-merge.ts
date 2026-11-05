import type {
  PullRequestStatus,
  TicketPull,
  TicketPullOrigin,
  TicketRef,
} from '@spark-outpost/contracts';
import { parsePullUrl } from './pull-status.ts';
import type { SourcePull } from './source.ts';

export interface MergedPull extends SourcePull {
  origin: TicketPullOrigin;
}

export const pullKey = (url: string) =>
  url
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();

export function refPull(ref: TicketRef): SourcePull {
  const address = parsePullUrl(ref.url);
  return {
    url: ref.url,
    title: ref.title === ref.url ? null : ref.title,
    state: 'unknown',
    branch: null,
    author: null,
    updatedAt: null,
    repo: address ? `${address.owner}/${address.name}` : null,
    number: address?.number ?? null,
  };
}

function fill(seen: MergedPull, pull: SourcePull): MergedPull {
  return {
    ...seen,
    title: seen.title ?? pull.title,
    state: seen.state === 'unknown' ? pull.state : seen.state,
    branch: seen.branch ?? pull.branch,
    author: seen.author ?? pull.author,
    updatedAt: seen.updatedAt ?? pull.updatedAt,
    repo: seen.repo ?? pull.repo,
    number: seen.number ?? pull.number,
  };
}

export function mergePulls(
  spark: readonly TicketRef[],
  linked: readonly SourcePull[],
  matched: readonly SourcePull[],
): MergedPull[] {
  const merged = new Map<string, MergedPull>();
  const add = (pull: SourcePull, origin: TicketPullOrigin) => {
    const key = pullKey(pull.url);
    const seen = merged.get(key);
    merged.set(key, seen ? fill(seen, pull) : { ...pull, origin });
  };
  for (const ref of spark) add(refPull(ref), 'spark');
  for (const pull of linked) add(pull, 'linked');
  for (const pull of matched) add(pull, 'matched');
  return [...merged.values()];
}

const isLive = (pull: MergedPull) => pull.state !== 'merged' && pull.state !== 'declined';

export function pullsToRead(
  pulls: readonly MergedPull[],
  latestSpark: string | null,
  limit: number,
): string[] {
  const others = pulls
    .filter((pull) => pull.origin !== 'spark' && isLive(pull) && parsePullUrl(pull.url))
    .slice(0, limit)
    .map((pull) => pull.url);
  return [...(latestSpark ? [latestSpark] : []), ...others];
}

export function finishPulls(
  pulls: readonly MergedPull[],
  statuses: ReadonlyMap<string, PullRequestStatus>,
  myLogins: ReadonlySet<string>,
): TicketPull[] {
  return pulls.map((pull) => {
    const status = statuses.get(pull.url) ?? null;
    const login = status?.author ?? (pull.origin === 'matched' ? pull.author : null);
    return {
      url: pull.url,
      repo: status?.repo ?? pull.repo,
      number: status?.number ?? pull.number,
      title: pull.title,
      origin: pull.origin,
      branch: pull.branch,
      author: pull.author ?? status?.author ?? null,
      updatedAt: pull.updatedAt,
      reported: pull.state,
      status,
      mine: pull.origin === 'spark' || (login ? myLogins.has(login.toLowerCase()) : false),
    };
  });
}

export function reportedStatus(pull: TicketPull): PullRequestStatus | null {
  if (pull.status) return pull.status;
  if (pull.repo === null || pull.number === null) return null;
  if (pull.reported !== 'open' && pull.reported !== 'draft') return null;
  return {
    url: pull.url,
    repo: pull.repo,
    number: pull.number,
    state: pull.reported === 'draft' ? 'draft' : 'review',
    openedAt: pull.updatedAt ?? '',
    mergedAt: null,
    checks: null,
  };
}

export interface AttentionPull {
  pull: PullRequestStatus | null;
  mine: boolean;
}

const ORIGIN_RANK: Record<TicketPullOrigin, number> = { spark: 0, linked: 1, matched: 2 };
const isOpen = (status: PullRequestStatus) =>
  status.state !== 'merged' && status.state !== 'closed';

export function attentionPull(
  pulls: readonly TicketPull[],
  latestSpark: string | null,
): AttentionPull {
  const spark = latestSpark
    ? pulls.find((pull) => pullKey(pull.url) === pullKey(latestSpark))
    : undefined;
  if (spark && spark.status?.state !== 'closed') return { pull: spark.status, mine: true };
  const others = pulls
    .filter((pull) => pull.origin !== 'spark' && (pull.origin === 'linked' || pull.mine))
    .flatMap((pull) => {
      const status = reportedStatus(pull);
      return status && isOpen(status) ? [{ pull, status }] : [];
    })
    .toSorted(
      (a, b) =>
        Number(b.pull.mine) - Number(a.pull.mine) ||
        ORIGIN_RANK[a.pull.origin] - ORIGIN_RANK[b.pull.origin] ||
        (b.pull.updatedAt ?? '').localeCompare(a.pull.updatedAt ?? ''),
    );
  const chosen = others[0];
  if (chosen) return { pull: chosen.status, mine: chosen.pull.mine };
  return { pull: spark?.status ?? null, mine: true };
}
