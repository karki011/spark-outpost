import { z } from 'zod';
import { connectionFor } from '../../ship/github/access.ts';
import { GITHUB_VIA, GitHubApiError, type GitHubConnection } from '../../ship/github/connection.ts';
import { listPulls, readPull, type Range } from '../../ship/github/pull-reads.ts';
import { pickRemote } from '../../ship/git.ts';
import { parseRemoteUrl, repoSlug, type RemoteRepo } from '../../ship/remote.ts';
import { gitHubDepsFor } from '../deps.ts';
import {
  limitInput,
  offsetInput,
  sparkTool,
  SparkToolError,
  type SparkToolContext,
} from '../tool.ts';
import { findProject } from './project-tools.ts';

interface ProjectRepo {
  project: string;
  repo: RemoteRepo;
  connection: GitHubConnection;
}

const projectInput = z
  .string()
  .max(200)
  .optional()
  .describe("Project name or id. Defaults to this chat's project.");

async function projectRepo(
  context: SparkToolContext,
  reference: string | undefined,
): Promise<ProjectRepo> {
  const project = await findProject(context, reference);
  const remote = await pickRemote(project.rootPath, null).catch(() => null);
  const repo = remote ? parseRemoteUrl(remote.url) : null;
  if (!repo) throw new SparkToolError(`${project.name} has no GitHub remote.`);
  const connection = await connectionFor(gitHubDepsFor(context.deps, context.scope), repo);
  if (!connection) {
    throw new SparkToolError(
      `GitHub is not connected for ${repo.host}. Connect GitHub in Settings.`,
    );
  }
  return { project: project.name, repo, connection };
}

async function reading<T>(repo: RemoteRepo, missing: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof GitHubApiError)) throw error;
    if (error.status === 404) {
      throw new SparkToolError(
        `GitHub found no ${missing} in ${repoSlug(repo)}, or this login can't see it.`,
      );
    }
    throw new SparkToolError(error.message);
  }
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function pageOf<T>(list: { total: number; items: T[] }, range: Range) {
  const next = range.offset + list.items.length;
  return {
    total: list.total,
    offset: range.offset,
    items: list.items,
    ...(next < list.total ? { nextOffset: next } : {}),
  };
}

async function pullRequests(
  context: SparkToolContext,
  args: { project?: string | undefined; state: 'open' | 'closed' | 'all'; limit: number },
) {
  const { project, repo, connection } = await projectRepo(context, args.project);
  const pulls = await reading(repo, 'repository', () =>
    listPulls(connection, repo, args.state, args.limit),
  );
  return {
    project,
    repo: repoSlug(repo),
    via: GITHUB_VIA[connection.method],
    state: args.state,
    pulls,
  };
}

async function pullRequest(
  context: SparkToolContext,
  args: {
    project?: string | undefined;
    number: number;
    offset: number;
    limit: number;
    maxChars: number;
  },
) {
  const { project, repo, connection } = await projectRepo(context, args.project);
  const range = { offset: args.offset, limit: args.limit };
  const pull = await reading(repo, `pull request #${args.number}`, () =>
    readPull(connection, repo, args.number, range),
  );
  const clipBody = <T extends { body: string }>(item: T) => ({
    ...item,
    body: clip(item.body, args.maxChars),
  });
  return {
    project,
    repo: repoSlug(repo),
    via: GITHUB_VIA[connection.method],
    ...pull,
    body: clip(pull.body, args.maxChars),
    files: pageOf(pull.files, range),
    reviewComments: pageOf(
      { total: pull.reviewComments.total, items: pull.reviewComments.items.map(clipBody) },
      range,
    ),
    issueComments: pageOf(
      { total: pull.issueComments.total, items: pull.issueComments.items.map(clipBody) },
      range,
    ),
  };
}

export const githubTools = [
  sparkTool({
    name: 'spark_pull_requests',
    privateData: async (args) => args.project !== undefined,
    needs: 'pull_requests',
    title: 'Pull requests',
    description:
      "Pull requests on a project's GitHub repo (default: this chat's project, open ones): number, title, author, draft, head → base, dates, review state, CI (passing, failing with names, pending, none) and whether it can merge.",
    input: {
      project: projectInput,
      state: z.enum(['open', 'closed', 'all']).default('open').describe('Which pull requests.'),
      limit: limitInput(10, 30),
    },
    run: (args, context) => pullRequests(context, args),
  }),
  sparkTool({
    name: 'spark_pr',
    privateData: async (args) => args.project !== undefined,
    needs: 'pull_requests',
    title: 'Pull request',
    description:
      "One pull request on a project's GitHub repo: title, body, state, author, branches, size, checks, reviews, and paged changed files, review comments and comments. offset/limit page all three lists together.",
    input: {
      project: projectInput,
      number: z.number().int().positive().describe('Pull request number.'),
      offset: offsetInput,
      limit: limitInput(30, 100),
      maxChars: z
        .number()
        .int()
        .min(200)
        .max(4000)
        .default(1500)
        .describe('Longest body or comment text to return (200-4000).'),
    },
    run: (args, context) => pullRequest(context, args),
  }),
];
