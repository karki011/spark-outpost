import { execFileSync } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCloneJobs, type CloneJobs } from '../src/projects/clone/clone-jobs.ts';
import { git, write } from './ship-support.ts';
import type { TestDb } from './support.ts';

export interface GitHubWorld {
  base: string;
  home: string;
  repos: string;
  sources: string;
  templates: string;
  hookMark: string;
  research: string;
}

const PLAIN_GIT = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

function run(...args: string[]): void {
  execFileSync('git', args, { env: PLAIN_GIT, stdio: 'ignore' });
}

async function sourceRepo(world: GitHubWorld): Promise<void> {
  const sub = path.join(world.base, 'sub-work');
  run('init', '-q', '-b', 'main', sub);
  await write(sub, 'lib.txt', 'sub\n');
  git(sub, '-c', 'user.name=T', '-c', 'user.email=t@example.test', 'add', '.');
  git(sub, '-c', 'user.name=T', '-c', 'user.email=t@example.test', 'commit', '-qm', 'sub');
  run('clone', '-q', '--bare', sub, path.join(world.sources, 'acme', 'sub.git'));
  const work = path.join(world.base, 'work');
  run('init', '-q', '-b', 'main', work);
  const commit = (message: string) =>
    git(work, '-c', 'user.name=T', '-c', 'user.email=t@example.test', 'commit', '-qm', message);
  await write(work, 'README.md', '# Widgets\n');
  git(work, 'add', '.');
  commit('first');
  await write(work, 'src/index.ts', 'export const widgets = 1;\n');
  git(work, 'add', '.');
  commit('second');
  git(work, 'branch', 'other');
  git(
    work,
    '-c',
    'protocol.file.allow=always',
    'submodule',
    'add',
    '-q',
    `file://${path.join(world.sources, 'acme', 'sub.git')}`,
    'vendor/sub',
  );
  commit('submodule');
  run('clone', '-q', '--bare', work, path.join(world.sources, 'acme', 'widgets.git'));
}

async function templateHook(world: GitHubWorld): Promise<void> {
  const hook = path.join(world.templates, 'hooks', 'post-checkout');
  await mkdir(path.dirname(hook), { recursive: true });
  await writeFile(hook, `#!/bin/sh\ntouch "${world.hookMark}"\n`);
  await chmod(hook, 0o755);
}

export async function gitHubWorld(): Promise<GitHubWorld> {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-gh-repos-')));
  const world: GitHubWorld = {
    base,
    home: path.join(base, 'home'),
    repos: path.join(base, 'home', 'code'),
    sources: path.join(base, 'sources'),
    templates: path.join(base, 'templates'),
    hookMark: path.join(base, 'hook-ran'),
    research: path.join(base, 'research'),
  };
  await mkdir(world.repos, { recursive: true });
  await sourceRepo(world);
  await templateHook(world);
  return world;
}

export function remapEnv(world: GitHubWorld): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: `url.file://${world.sources}/.insteadOf`,
    GIT_CONFIG_VALUE_0: 'https://github.com/',
    GIT_CONFIG_KEY_1: 'init.templateDir',
    GIT_CONFIG_VALUE_1: world.templates,
  };
}

export function testCloneJobs(t: TestDb, world: GitHubWorld, gitPath?: string): CloneJobs {
  return createCloneJobs({
    db: t.db,
    workspaceId: t.workspaceId,
    home: async () => world.home,
    reserved: [],
    tokensFor: async () => [],
    loginEnv: async () => remapEnv(world),
    allowFileProtocol: true,
    ...(gitPath ? { gitPath } : {}),
  });
}

export async function stallingGit(world: GitHubWorld): Promise<string> {
  const file = path.join(world.base, 'stalling-git');
  await writeFile(
    file,
    `#!/bin/sh\nfor last; do :; done\nmkdir -p "$last/.git"\necho partial > "$last/.git/partial"\ntrap 'exit 143' TERM\nsleep 60 &\nwait $!\n`,
  );
  await chmod(file, 0o755);
  return file;
}

export const exists = (target: string) =>
  access(target).then(
    () => true,
    () => false,
  );

export async function removeWorld(world: GitHubWorld): Promise<void> {
  await rm(world.base, { recursive: true, force: true });
}
