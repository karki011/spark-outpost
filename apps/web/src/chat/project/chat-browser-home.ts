import { useMemo } from 'react';
import type { ChatBranch, Project } from '@spark-outpost/contracts';
import type { BrowserHome } from '../../browser/use-view-placement.ts';

export function useChatBrowserHome(
  chatId: string,
  branch: ChatBranch | null,
  repos: readonly Project[],
  terminal: boolean,
): { roots: string[]; home: BrowserHome } {
  const roots = useMemo(
    () => [...(branch?.worktree ? [branch.path] : []), ...repos.map((repo) => repo.rootPath)],
    [branch, repos],
  );
  const home: BrowserHome = {
    chatId,
    projectId: repos[0]?.id ?? null,
    roots,
    sendsTo: terminal ? 'terminal' : 'chat',
  };
  return { roots, home };
}
