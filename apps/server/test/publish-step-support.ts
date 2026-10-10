import { runChatTurn } from '../src/workflow/chat-turn.ts';
import { randomUUID } from 'node:crypto';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import type { RunTurn } from '../src/workflow/worker.ts';
import { linkedConversation } from './approval-support.ts';
import { FAKE_GH, git, repoWithRemote, type TestRepo } from './ship-support.ts';
import { pinChatLevel, type TestDb } from './support.ts';
import { auditOf } from './turn-support.ts';

export const CHAT_BRANCH = 'spark/notes-1a2b3c4d';

export function publishingTurn(gitHubApi: () => string): RunTurn {
  return (deps, lease) => {
    const shipAccess = {
      secrets: memorySecretStore(),
      runCommand,
      fetch,
      apiUrl: gitHubApi(),
      locateGh: async () => FAKE_GH,
    };
    return runChatTurn({ ...deps, shipAccess }, lease);
  };
}

export interface BranchChat {
  conversationId: string;
  repo: TestRepo;
}

export async function chatOnItsBranch(
  t: TestDb,
  base: string,
  name: string,
  level: InvolvementLevel,
  remote: 'github' | 'none' = 'github',
): Promise<BranchChat> {
  const repo = await repoWithRemote(base, name, remote);
  git(repo.root, 'checkout', '-q', '-b', CHAT_BRANCH);
  const linked = await linkedConversation(t, repo.root);
  await pinChatLevel(t.db, linked.conversationId, level);
  await insertChatWorktree(t.db, {
    id: randomUUID(),
    conversationId: linked.conversationId,
    projectId: linked.projectId,
    repoRoot: repo.root,
    path: repo.root,
    branch: CHAT_BRANCH,
    baseBranch: 'main',
    baseCommit: git(repo.root, 'rev-parse', 'HEAD'),
    landedCommit: null,
    inPlace: false,
    ownsBranch: true,
  });
  return { conversationId: linked.conversationId, repo };
}

export async function promptsOf(t: TestDb, runId: string): Promise<number> {
  const entries = await auditOf(t, runId);
  return entries.filter((entry) => entry.method === 'session/prompt' && entry.kind === 'request')
    .length;
}
