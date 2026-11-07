import path from 'node:path';
import type { GitHubDeps } from '../../ship/github/access.ts';
import { loginEnv, tokensForRemote } from '../../ship/push.ts';
import { realHome } from '../projects.ts';
import { createCloneJobs, type CloneJobs } from './clone-jobs.ts';

export interface AgentClones {
  jobsFor(workspaceId: string): CloneJobs;
  stopAll(): void;
}

export function agentClones(
  github: Omit<GitHubDeps, 'workspaceId'>,
  reservedFolders: readonly (string | null | undefined)[],
): AgentClones {
  const reserved = reservedFolders
    .filter((folder): folder is string => !!folder)
    .map((folder) => path.resolve(folder));
  const jobs = new Map<string, CloneJobs>();
  return {
    jobsFor(workspaceId) {
      const known = jobs.get(workspaceId);
      if (known) return known;
      const deps: GitHubDeps = { ...github, workspaceId };
      const created = createCloneJobs({
        db: github.db,
        workspaceId,
        home: realHome,
        reserved,
        tokensFor: async (url) => (await tokensForRemote(deps, url)).map((entry) => entry.token),
        loginEnv: () => loginEnv(deps),
      });
      jobs.set(workspaceId, created);
      return created;
    },
    stopAll() {
      for (const created of jobs.values()) created.stopAll();
    },
  };
}
