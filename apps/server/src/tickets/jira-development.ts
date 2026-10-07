import { z } from 'zod';
import type { ReportedPullState, TicketBranch } from '@spark-outpost/contracts';
import { parsePullUrl } from './pull-status.ts';
import { TicketApiError, type SourceDevelopment, type SourcePull } from './source.ts';

export const DEV_STATUS_TIMEOUT_MS = 8_000;
const MAX_INSTANCE_TYPES = 3;
const MAX_ENTRIES = 20;
const TEXT_LIMIT = 300;

const count = z.number().int().nonnegative();
const instances = z.record(z.string(), z.object({ count })).optional();
const overall = z.object({ count, lastUpdated: z.string().nullable().optional() });
const group = z.object({ overall, byInstanceType: instances });
const buildGroup = z.object({
  overall: overall.extend({
    failedBuildCount: count.optional(),
    successfulBuildCount: count.optional(),
  }),
  byInstanceType: instances,
});
const summarySchema = z.object({
  summary: z.object({
    pullrequest: group.optional(),
    branch: group.optional(),
    repository: group.optional(),
    build: buildGroup.optional(),
  }),
});

const httpUrl = z.string().regex(/^https?:\/\//i);
const pullSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  url: httpUrl,
  status: z.string(),
  lastUpdate: z.string().optional(),
  author: z.object({ name: z.string() }).nullable().optional(),
  source: z.object({ branch: z.string() }).nullable().optional(),
  repositoryName: z.string().optional(),
});
const branchSchema = z.object({
  name: z.string(),
  url: httpUrl.optional(),
  repository: z.object({ name: z.string() }).nullable().optional(),
});
const detailSchema = z.object({
  detail: z.array(
    z.object({
      pullRequests: z.array(pullSchema).optional(),
      branches: z.array(branchSchema).optional(),
    }),
  ),
});

type DevSummary = z.infer<typeof summarySchema>['summary'];
type DevDetail = z.infer<typeof detailSchema>['detail'];

const PULL_STATES: Record<string, ReportedPullState> = {
  OPEN: 'open',
  DRAFT: 'draft',
  MERGED: 'merged',
  DECLINED: 'declined',
};

const clip = (text: string | undefined) => (text ? text.slice(0, TEXT_LIMIT) : null);

function isoOrNull(value: string | null | undefined): string | null {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function unexpected(): TicketApiError {
  return new TicketApiError(502, 'Jira sent development information Spark could not read.');
}

export function parseDevSummary(data: unknown): DevSummary {
  const parsed = summarySchema.safeParse(data);
  if (!parsed.success) throw unexpected();
  return parsed.data.summary;
}

function pullOf(pull: z.infer<typeof pullSchema>): SourcePull {
  const address = parsePullUrl(pull.url);
  const idNumber = Number(/(\d+)$/.exec(pull.id ?? '')?.[1]);
  const number = address?.number ?? (Number.isInteger(idNumber) && idNumber > 0 ? idNumber : null);
  return {
    url: pull.url,
    title: clip(pull.name),
    state: PULL_STATES[pull.status.toUpperCase()] ?? 'unknown',
    branch: clip(pull.source?.branch),
    author: clip(pull.author?.name),
    updatedAt: isoOrNull(pull.lastUpdate),
    repo: address ? `${address.owner}/${address.name}` : clip(pull.repositoryName),
    number,
  };
}

export function parseDevDetail(data: unknown): {
  pullRequests: SourcePull[];
  branches: TicketBranch[];
} {
  const parsed = detailSchema.safeParse(data);
  if (!parsed.success) throw unexpected();
  const detail: DevDetail = parsed.data.detail;
  return {
    pullRequests: detail.flatMap((entry) => entry.pullRequests ?? []).map(pullOf),
    branches: detail
      .flatMap((entry) => entry.branches ?? [])
      .map((branch) => ({
        name: branch.name.slice(0, TEXT_LIMIT),
        url: branch.url ?? null,
        repo: clip(branch.repository?.name),
      })),
  };
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item] as const)).values()];
}

function detailRequests(summary: DevSummary): { type: string; dataType: string }[] {
  const wanted = [
    { group: summary.pullrequest, dataType: 'pullrequest' },
    { group: summary.branch, dataType: 'branch' },
  ];
  return wanted.flatMap(({ group: entry, dataType }) =>
    Object.entries(entry?.byInstanceType ?? {})
      .filter(([, instance]) => instance.count > 0)
      .slice(0, MAX_INSTANCE_TYPES)
      .map(([type]) => ({ type, dataType })),
  );
}

export type DevStatusGet = (path: string) => Promise<unknown>;

export async function readJiraDevelopment(
  get: DevStatusGet,
  issueId: string,
): Promise<SourceDevelopment> {
  const id = encodeURIComponent(issueId);
  const summary = parseDevSummary(await get(`/rest/dev-status/latest/issue/summary?issueId=${id}`));
  const pullRequests: SourcePull[] = [];
  const branches: TicketBranch[] = [];
  for (const { type, dataType } of detailRequests(summary)) {
    const query = `issueId=${id}&applicationType=${encodeURIComponent(type)}&dataType=${dataType}`;
    const detail = parseDevDetail(await get(`/rest/dev-status/latest/issue/detail?${query}`));
    pullRequests.push(...detail.pullRequests);
    branches.push(...detail.branches);
  }
  const builds = summary.build?.overall;
  const commits = summary.repository?.overall;
  return {
    pullRequests: uniqueBy(pullRequests, (pull) => pull.url).slice(0, MAX_ENTRIES),
    branches: uniqueBy(branches, (branch) => `${branch.repo ?? ''}:${branch.name}`).slice(
      0,
      MAX_ENTRIES,
    ),
    commits:
      commits && commits.count > 0
        ? { count: commits.count, lastAt: isoOrNull(commits.lastUpdated) }
        : null,
    builds:
      builds && builds.count > 0
        ? {
            count: builds.count,
            failed: builds.failedBuildCount ?? 0,
            passed: builds.successfulBuildCount ?? 0,
          }
        : null,
  };
}
