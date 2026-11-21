import { z } from 'zod';
import type { GithubPullDetails } from '@spark-outpost/contracts';
import { connectionsFor, type GitHubDeps } from '../ship/github/access.ts';
import { repoPath, type GitHubConnection } from '../ship/github/connection.ts';
import { GITHUB_PAGE_SIZE } from '../ship/github/pull-reads.ts';
import { cachedInboxPull } from './load.ts';

const BODY_LIMIT = 60_000;
const PATH_LIMIT = 500;

export class PullDetailsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function pullDetailsErrorStatus(error: unknown): { status: number; message: string } | null {
  return error instanceof PullDetailsError
    ? { status: error.status, message: error.message }
    : null;
}

const pullSchema = z.object({
  body: z.string().nullable().optional(),
  changed_files: z.number().int().nonnegative().optional(),
});

const fileSchema = z.object({
  filename: z.string(),
  status: z.string().catch('modified'),
  additions: z.number().int().nonnegative().catch(0),
  deletions: z.number().int().nonnegative().catch(0),
});

async function readWith(connection: GitHubConnection, path: string, number: number) {
  return Promise.all([
    connection.get(path, pullSchema, `reading pull request #${number}`),
    connection.get(
      `${path}/files?per_page=${GITHUB_PAGE_SIZE}`,
      z.array(fileSchema),
      'reading the changed files',
    ),
  ]);
}

export async function loadPullDetails(deps: GitHubDeps, id: string): Promise<GithubPullDetails> {
  const found = cachedInboxPull(deps.db, id);
  if (!found) throw new PullDetailsError(404, 'That pull request is not on the GitHub page.');
  const [owner = '', name = ''] = found.repo.split('/');
  const repo = { host: found.host, owner, name };
  const connections = await connectionsFor(deps, repo).catch(() => []);
  if (connections.length === 0) {
    throw new PullDetailsError(409, 'No GitHub connection reaches this repository.');
  }
  const path = `${repoPath(repo)}/pulls/${found.number}`;
  let failure: unknown = null;
  for (const connection of connections) {
    try {
      const [pull, files] = await readWith(connection, path, found.number);
      return detailsOf(id, pull, files);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

function detailsOf(
  id: string,
  pull: z.infer<typeof pullSchema>,
  files: z.infer<typeof fileSchema>[],
): GithubPullDetails {
  const body = pull.body ?? '';
  return {
    id,
    body: body.slice(0, BODY_LIMIT),
    bodyCut: body.length > BODY_LIMIT,
    files: files.map((file) => ({
      path: file.filename.slice(0, PATH_LIMIT),
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
    })),
    filesTotal: Math.max(pull.changed_files ?? 0, files.length),
  };
}
