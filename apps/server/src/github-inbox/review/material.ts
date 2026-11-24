import { z } from 'zod';
import type { GithubInboxTicket } from '@spark-outpost/contracts';
import { knownTicketsNamed } from '../../persistence/github-inbox.ts';
import { listProjects } from '../../projects/projects.ts';
import { DEFAULT_GITHUB_HOST, connectionFor, type GitHubDeps } from '../../ship/github/access.ts';
import { repoPath, type GitHubConnection } from '../../ship/github/connection.ts';
import { GITHUB_PAGE_SIZE } from '../../ship/github/pull-reads.ts';
import { repoSlug, type RemoteRepo } from '../../ship/remote.ts';
import { projectRepos } from '../../tickets/github-pulls.ts';
import { keysIn } from '../../tickets/pull-ticket-keys.ts';

const DIFF_LIMIT = 200_000;
const DISCUSSION_LIMIT = 60_000;
const MAX_PAGES = 30;
const HEAD_ATTEMPTS = 3;

export const PULL_MOVING =
  'The pull request kept changing while Spark read it. Try again in a moment.';

export class ReviewSetupError extends Error {}

export interface LinkedPull {
  repo: RemoteRepo;
  number: number;
}

export function parsePullId(pull: string): { slug: string; number: number } | null {
  const match = /^([^/#\s]+\/[^/#\s]+)#([1-9]\d{0,9})$/.exec(pull);
  return match ? { slug: match[1]!, number: Number(match[2]) } : null;
}

export async function linkedPull(deps: GitHubDeps, pull: string): Promise<LinkedPull | null> {
  const parsed = parsePullId(pull);
  if (!parsed) return null;
  const projects = await listProjects(deps.db, deps.workspaceId).catch(() => []);
  const found = (await projectRepos(projects)).find(
    (entry) => repoSlug(entry.repo).toLowerCase() === parsed.slug.toLowerCase(),
  );
  return found ? { repo: found.repo, number: parsed.number } : null;
}

export async function connectionForPull(
  deps: GitHubDeps,
  pull: string,
): Promise<{ connection: GitHubConnection; linked: LinkedPull }> {
  const linked = await linkedPull(deps, pull);
  if (!linked)
    throw new ReviewSetupError('This pull request’s repository is not a linked project.');
  const connection = await connectionFor(deps, linked.repo).catch(() => null);
  if (!connection) throw new ReviewSetupError('No GitHub connection reaches this repository.');
  return { connection, linked };
}

function unlinkedPull(parsed: { slug: string; number: number }, host: string): LinkedPull {
  const [owner, name] = parsed.slug.split('/') as [string, string];
  return { repo: { host, owner, name }, number: parsed.number };
}

export async function reachablePull(
  deps: GitHubDeps,
  pull: string,
  namedHost: string | null,
): Promise<{ connection: GitHubConnection; linked: LinkedPull } | null> {
  const parsed = parsePullId(pull);
  if (!parsed) return null;
  const known = await linkedPull(deps, pull);
  const onNamedHost = known !== null && (namedHost === null || known.repo.host === namedHost);
  const linked = onNamedHost ? known : unlinkedPull(parsed, namedHost ?? DEFAULT_GITHUB_HOST);
  const connection = await connectionFor(deps, linked.repo).catch(() => null);
  return connection ? { connection, linked } : null;
}

const login = z.object({ login: z.string() }).nullable();

export const pullSchema = z.object({
  title: z.string(),
  body: z.string().nullable().optional(),
  html_url: z.string(),
  state: z.string(),
  draft: z.boolean().optional(),
  merged: z.boolean().optional(),
  user: login,
  head: z.object({ ref: z.string(), sha: z.string() }),
  base: z.object({ ref: z.string() }),
  changed_files: z.number().int().default(0),
});

const fileSchema = z.object({
  filename: z.string(),
  status: z.string(),
  patch: z.string().optional(),
});

const reviewCommentSchema = z.object({
  id: z.number(),
  path: z.string(),
  line: z.number().int().nullable().optional(),
  user: login,
  body: z.string(),
  in_reply_to_id: z.number().optional(),
});

const reviewSchema = z.object({
  user: login,
  state: z.string(),
  body: z.string().nullable().optional(),
});
const issueCommentSchema = z.object({ user: login, body: z.string() });

type Pull = z.infer<typeof pullSchema>;
type File = z.infer<typeof fileSchema>;
type ReviewComment = z.infer<typeof reviewCommentSchema>;
type Review = z.infer<typeof reviewSchema>;
type IssueComment = z.infer<typeof issueCommentSchema>;

export interface MaterialFacts {
  pull: string;
  detail: Pull;
  files: File[];
  reviewComments: ReviewComment[];
  reviews: Review[];
  issueComments: IssueComment[];
  ticket: GithubInboxTicket | null;
  earlier: { headSha: string; body: string } | null;
}

async function pages<T>(
  connection: GitHubConnection,
  path: string,
  schema: z.ZodType<T>,
  action: string,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const listed = await connection.get(
      `${path}${path.includes('?') ? '&' : '?'}per_page=${GITHUB_PAGE_SIZE}&page=${page}`,
      z.array(schema),
      action,
    );
    all.push(...listed);
    if (listed.length < GITHUB_PAGE_SIZE) break;
  }
  return all;
}

export async function readPullBasics(
  connection: GitHubConnection,
  linked: LinkedPull,
): Promise<Pull> {
  return connection.get(
    `${repoPath(linked.repo)}/pulls/${linked.number}`,
    pullSchema,
    `reading pull request #${linked.number}`,
  );
}

async function pullAtOneHead(
  connection: GitHubConnection,
  linked: LinkedPull,
): Promise<{ detail: Pull; files: File[] }> {
  const path = `${repoPath(linked.repo)}/pulls/${linked.number}/files`;
  let detail = await readPullBasics(connection, linked);
  for (let attempt = 0; attempt < HEAD_ATTEMPTS; attempt += 1) {
    const files = await pages(connection, path, fileSchema, 'reading the changed files');
    const after = await readPullBasics(connection, linked);
    if (after.head.sha === detail.head.sha) return { detail: after, files };
    detail = after;
  }
  throw new ReviewSetupError(PULL_MOVING);
}

export async function gatherMaterial(
  deps: GitHubDeps,
  pull: string,
  earlier: MaterialFacts['earlier'],
): Promise<MaterialFacts> {
  const { connection, linked } = await connectionForPull(deps, pull);
  return gatherMaterialFrom(deps, { connection, linked }, pull, earlier);
}

export async function gatherMaterialFrom(
  deps: Pick<GitHubDeps, 'db' | 'workspaceId'>,
  { connection, linked }: { connection: GitHubConnection; linked: LinkedPull },
  pull: string,
  earlier: MaterialFacts['earlier'],
): Promise<MaterialFacts> {
  const { detail, files } = await pullAtOneHead(connection, linked);
  const path = `${repoPath(linked.repo)}/pulls/${linked.number}`;
  const [reviewComments, reviews, issueComments] = await Promise.all([
    pages(connection, `${path}/comments`, reviewCommentSchema, 'reading review comments'),
    pages(connection, `${path}/reviews`, reviewSchema, 'reading reviews'),
    pages(
      connection,
      `${repoPath(linked.repo)}/issues/${linked.number}/comments`,
      issueCommentSchema,
      'reading comments',
    ),
  ]);
  const keys = keysIn(detail.head.ref, detail.title);
  const tickets = await knownTicketsNamed(deps.db, deps.workspaceId, keys);
  const key = keys.find((candidate) => tickets.has(candidate.toUpperCase()));
  return {
    pull,
    detail,
    files,
    reviewComments,
    reviews,
    issueComments,
    ticket: key ? (tickets.get(key.toUpperCase()) ?? null) : null,
    earlier,
  };
}

const who = (user: z.infer<typeof login>) => `@${user?.login ?? 'ghost'}`;

function clip(text: string, limit: number, note: string): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[${note}]`;
}

function diffOf(files: readonly File[]): string {
  const parts = files.map((file) =>
    file.patch === undefined
      ? `--- ${file.filename} (${file.status}; GitHub sent no patch, for example a binary or very large file)`
      : `--- ${file.filename} (${file.status})\n${file.patch}`,
  );
  return clip(parts.join('\n\n'), DIFF_LIMIT, 'The diff is cut here; it is longer.');
}

function discussionOf(facts: MaterialFacts): string {
  const reviews = facts.reviews
    .filter((review) => review.state !== 'PENDING')
    .map(
      (review) =>
        `${who(review.user)} ${review.state.toLowerCase()}${review.body?.trim() ? `:\n${review.body.trim()}` : ''}`,
    );
  const threads = facts.reviewComments.map((comment) => {
    const place = `${comment.path}${comment.line ? `:${comment.line}` : ''}`;
    const reply = comment.in_reply_to_id ? ` (reply to comment ${comment.in_reply_to_id})` : '';
    return `Comment ${comment.id} on ${place} by ${who(comment.user)}${reply}:\n${comment.body}`;
  });
  const comments = facts.issueComments.map(
    (comment) => `${who(comment.user)} commented:\n${comment.body}`,
  );
  const all = [...reviews, ...threads, ...comments];
  if (all.length === 0) return '(none yet)';
  return clip(all.join('\n\n'), DISCUSSION_LIMIT, 'Earlier discussion is cut here.');
}

function ticketOf(ticket: GithubInboxTicket | null): string {
  if (!ticket) return '(no linked ticket found)';
  const parts = [`${ticket.key}: ${ticket.title ?? '(no title)'}`];
  if (ticket.status) parts.push(`Status: ${ticket.status}`);
  if (ticket.url) parts.push(ticket.url);
  return parts.join('\n');
}

export function renderMaterial(facts: MaterialFacts): string {
  const { detail } = facts;
  const lines = [
    `Pull request: ${facts.pull}`,
    `Link: ${detail.html_url}`,
    `Title: ${detail.title}`,
    `Author: ${who(detail.user)}`,
    `Branch: ${detail.head.ref} into ${detail.base.ref}`,
    `Head commit: ${detail.head.sha}`,
    '',
    'Description:',
    detail.body?.trim() || '(empty)',
    '',
    'Linked ticket:',
    ticketOf(facts.ticket),
    '',
    'Reviews and comments so far:',
    discussionOf(facts),
  ];
  if (facts.earlier) {
    lines.push(
      '',
      `Your own earlier review of this pull request (at commit ${facts.earlier.headSha}):`,
      facts.earlier.body,
    );
  }
  lines.push('', 'Diff:', diffOf(facts.files));
  return lines.join('\n');
}
