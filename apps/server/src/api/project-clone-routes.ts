import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import {
  startCloneRequestSchema,
  type CloneJobs as CloneJobList,
  type CloneOptions,
} from '@spark-outpost/contracts';
import { CloneRefusedError, isWithin } from '../projects/clone/clone-destination.ts';
import { createCloneJobs, type CloneJobs } from '../projects/clone/clone-jobs.ts';
import { realHome } from '../projects/projects.ts';
import { effectiveReposFolders, sparkReposRules } from '../projects/repos-folders.ts';
import { cloneableRepos } from '../ship/github/clone-repos.ts';
import { loginEnv, tokensForRemote } from '../ship/push.ts';
import { gitHubDepsOf, type GitHubRouteDeps } from './ship-routes.ts';
import { paramId, parseBody } from './validation.ts';

export interface CloneTestOverrides {
  root: string;
  gitPath?: string;
  tokensFor?: (url: string) => Promise<string[]>;
}

export interface CloneRouteDeps extends GitHubRouteDeps {
  clones?: CloneJobs;
  cloneTest?: CloneTestOverrides | null;
  reservedFolders?: readonly (string | null | undefined)[];
}

const DEFAULT_PARENT = 'Documents';
const TEST_REMAPPED_HOSTS = ['https://github.com/', 'https://clone.test/'];

function testRemap(root: string): Record<string, string> {
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(TEST_REMAPPED_HOSTS.length) };
  TEST_REMAPPED_HOSTS.forEach((host, index) => {
    env[`GIT_CONFIG_KEY_${index}`] = `url.file://${root}/sources/.insteadOf`;
    env[`GIT_CONFIG_VALUE_${index}`] = host;
  });
  return env;
}

async function real(folder: string): Promise<string> {
  return realpath(folder).catch(() => path.resolve(folder));
}

export function cloneJobsFor(deps: CloneRouteDeps): CloneJobs {
  const github = gitHubDepsOf(deps);
  const test = deps.cloneTest ?? null;
  const reserved = (deps.reservedFolders ?? []).filter((folder): folder is string => !!folder);
  return createCloneJobs({
    db: deps.db,
    workspaceId: deps.workspaceId,
    home: () => (test ? real(test.root) : realHome()),
    reserved: reserved.map((folder) => path.resolve(folder)),
    tokensFor:
      test?.tokensFor ??
      (async (url) => (await tokensForRemote(github, url)).map((entry) => entry.token)),
    loginEnv: async () => ({
      ...(await loginEnv(github)),
      ...(test ? testRemap(await real(test.root)) : {}),
    }),
    ...(test?.gitPath ? { gitPath: test.gitPath } : {}),
    allowFileProtocol: test !== null,
  });
}

async function isFolder(target: string): Promise<boolean> {
  return stat(target)
    .then((stats) => stats.isDirectory())
    .catch(() => false);
}

async function defaultParent(deps: CloneRouteDeps, home: string): Promise<string> {
  const [first] = await effectiveReposFolders(deps.db, deps.workspaceId, sparkReposRules());
  if (first && isWithin(first.path, home) && (await isFolder(first.path))) return first.path;
  const documents = path.join(home, DEFAULT_PARENT);
  return (await isFolder(documents)) ? documents : home;
}

export function cloneErrorStatus(error: unknown): { status: number; message: string } | null {
  return error instanceof CloneRefusedError ? { status: 400, message: error.message } : null;
}

export function projectCloneRoutes(deps: CloneRouteDeps): Router {
  const router = Router();
  const clones = deps.clones ?? cloneJobsFor(deps);
  const github = gitHubDepsOf(deps);
  const list = (): CloneJobList => ({ jobs: clones.list() });

  router.get('/project-clones/options', async (_req, res) => {
    const home = deps.cloneTest ? await real(deps.cloneTest.root) : await real(homedir());
    const options: CloneOptions = {
      defaultParent: await defaultParent(deps, home),
      ...(await cloneableRepos(github)),
    };
    res.json(options);
  });

  router.get('/project-clones', (_req, res) => {
    res.json(list());
  });

  router.post('/project-clones', async (req, res) => {
    const { job, started } = await clones.start(parseBody(startCloneRequestSchema, req));
    res.status(started ? 202 : 200).json(job);
  });

  router.post('/project-clones/:id/cancel', async (req, res) => {
    const job = await clones.cancel(paramId(req));
    if (!job) {
      res.status(404).json({ error: 'That clone is no longer running.' });
      return;
    }
    res.json(job);
  });

  router.delete('/project-clones/:id', (req, res) => {
    clones.dismiss(paramId(req));
    res.json(list());
  });

  return router;
}
