import { z } from 'zod';
import type { OpenPull } from '@spark-outpost/contracts';
import type { RunCommand } from '../setup/command.ts';
import type { RemoteRepo } from '../ship/remote.ts';

const GH_TIMEOUT_MS = 20_000;
const LIST_LIMIT = 50;
const FIELDS = [
  'number',
  'title',
  'url',
  'author',
  'headRefName',
  'baseRefName',
  'isCrossRepository',
  'maintainerCanModify',
  'headRepository',
  'headRepositoryOwner',
  'state',
].join(',');

const ghPullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  author: z.object({ login: z.string() }).nullable().optional(),
  headRefName: z.string(),
  baseRefName: z.string(),
  isCrossRepository: z.boolean(),
  maintainerCanModify: z.boolean(),
  headRepository: z.object({ name: z.string() }).nullable().optional(),
  headRepositoryOwner: z.object({ login: z.string() }).nullable().optional(),
  state: z.string().optional(),
});
type GhPull = z.infer<typeof ghPullSchema>;

export interface HeadRepo {
  owner: string;
  name: string;
}

export interface FoundPull {
  pull: OpenPull;
  headRepo: HeadRepo;
  open: boolean;
}

export interface GhRunner {
  gh: string;
  runCommand: RunCommand;
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function repoFlag(repo: RemoteRepo): string {
  return `${repo.host}/${repo.owner}/${repo.name}`;
}

function toPull(raw: GhPull, repo: RemoteRepo): FoundPull {
  return {
    pull: {
      number: raw.number,
      title: raw.title,
      url: raw.url,
      author: raw.author?.login ?? 'unknown',
      head: raw.headRefName,
      base: raw.baseRefName,
      fork: raw.isCrossRepository,
      maintainerCanModify: raw.maintainerCanModify,
    },
    headRepo: {
      owner: raw.headRepositoryOwner?.login ?? repo.owner,
      name: raw.headRepository?.name ?? repo.name,
    },
    open: (raw.state ?? 'OPEN').toUpperCase() === 'OPEN',
  };
}

function ghProblem(stderr: string): string {
  const line = stderr.trim().split('\n')[0] ?? '';
  return line ? `gh said: ${line}` : 'gh could not list pull requests.';
}

export async function listOpenPulls(
  runner: GhRunner,
  repo: RemoteRepo,
): Promise<{ pulls: OpenPull[]; problem: string | null }> {
  const args = ['pr', 'list', '-R', repoFlag(repo), '--state', 'open'];
  const result = await runner.runCommand(
    runner.gh,
    [...args, '--limit', String(LIST_LIMIT), '--json', FIELDS],
    GH_TIMEOUT_MS,
  );
  if (result.code !== 0) return { pulls: [], problem: ghProblem(result.stderr) };
  const parsed = z.array(ghPullSchema).safeParse(parsedJson(result.stdout));
  if (!parsed.success)
    return { pulls: [], problem: 'gh returned pull requests Spark could not read.' };
  return { pulls: parsed.data.map((raw) => toPull(raw, repo).pull), problem: null };
}

export async function viewPull(
  runner: GhRunner,
  repo: RemoteRepo,
  number: number,
): Promise<FoundPull | null> {
  const result = await runner.runCommand(
    runner.gh,
    ['pr', 'view', String(number), '-R', repoFlag(repo), '--json', FIELDS],
    GH_TIMEOUT_MS,
  );
  if (result.code !== 0) return null;
  const parsed = ghPullSchema.safeParse(parsedJson(result.stdout));
  return parsed.success ? toPull(parsed.data, repo) : null;
}

export async function protectedOnHost(
  runner: GhRunner,
  repo: RemoteRepo,
  head: HeadRepo,
  branch: string,
): Promise<boolean> {
  const result = await runner.runCommand(
    runner.gh,
    [
      'api',
      '--hostname',
      repo.host,
      '-X',
      'GET',
      `repos/${head.owner}/${head.name}/branches/${encodeURIComponent(branch)}`,
      '--jq',
      '.protected',
    ],
    GH_TIMEOUT_MS,
  );
  return result.code === 0 && result.stdout.trim() === 'true';
}
