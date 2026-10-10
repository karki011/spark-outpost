import { execFile } from 'node:child_process';
import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { assertScratchPath, scratchBase } from '../paths.ts';
import { templateFiles } from './files.ts';
import { linkToolchain, type Toolchain } from './toolchain.ts';

const run = promisify(execFile);
const COMMIT_DATE = '2026-10-09T00:00:00Z';
const IDENTITY = { name: 'Scratch Owner', email: 'scratch@spark.local' };

export interface ScratchRepo {
  path: string;
  commit: string;
  toolchain: Toolchain;
}

async function git(repo: string, ...args: string[]): Promise<string> {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: COMMIT_DATE,
    GIT_COMMITTER_DATE: COMMIT_DATE,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
  const { stdout } = await run('git', ['-C', repo, ...args], { env });
  return stdout.trim();
}

export async function headCommit(repo: string): Promise<string> {
  return git(repo, 'rev-parse', 'HEAD');
}

export async function buildGolden(base: string = scratchBase()): Promise<ScratchRepo> {
  const root = assertScratchPath(base);
  const path = join(root, 'golden');
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
  const toolchain = await linkToolchain(root);
  for (const file of await templateFiles()) {
    const target = join(path, file.target);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(file.source, target);
  }
  await git(path, 'init', '--quiet', '--initial-branch=main');
  await git(path, 'config', 'user.name', IDENTITY.name);
  await git(path, 'config', 'user.email', IDENTITY.email);
  await git(path, 'config', 'commit.gpgsign', 'false');
  await git(path, 'add', '--all');
  await git(path, 'commit', '--quiet', '--message', 'Ledger scratch project');
  return { path, commit: await headCommit(path), toolchain };
}

export async function freshCopy(name: string, base: string = scratchBase()): Promise<ScratchRepo> {
  const root = assertScratchPath(base);
  const golden = await buildGolden(root);
  const path = assertScratchPath(join(root, 'runs', name, 'repo'));
  await rm(dirname(path), { recursive: true, force: true });
  await mkdir(dirname(path), { recursive: true });
  await cp(golden.path, path, { recursive: true });
  const commit = await headCommit(path);
  if (commit !== golden.commit) throw new Error('The fresh copy is not at the starting commit.');
  const remotes = await git(path, 'remote');
  if (remotes !== '') throw new Error('The scratch repository must have no remote.');
  return { path, commit, toolchain: golden.toolchain };
}

const REMOVE_RETRIES = 10;
const REMOVE_RETRY_MS = 200;

export async function removeCopy(repo: ScratchRepo): Promise<void> {
  await rm(dirname(assertScratchPath(repo.path)), {
    recursive: true,
    force: true,
    maxRetries: REMOVE_RETRIES,
    retryDelay: REMOVE_RETRY_MS,
  });
}
