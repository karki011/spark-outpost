import { randomUUID } from 'node:crypto';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { saveGitHubToken } from '../src/persistence/github-tokens.ts';
import { trackedPullsOf, type TrackedPull } from '../src/persistence/tracked-pulls.ts';
import type { FollowUpDeps } from '../src/pr-follow-up/deps.ts';
import { runCommand } from '../src/setup/command.ts';
import type { SecretStore } from '../src/setup/secrets.ts';
import type { GitHubDeps } from '../src/ship/github/access.ts';
import { createTaskRecorder } from '../src/workflow/task-recorder.ts';
import { linkedConversation, sendDo } from './approval-support.ts';
import type { FakePull } from './fake-github.ts';
import { git, repoWithRemote, type GitHubStub } from './ship-support.ts';
import type { TestDb } from './support.ts';

export const CHAT_BRANCH = 'spark/tidy-the-notes-0a1b2c3d';
export const TOKEN_LOGIN = 'octo-token';
const SAVED_TOKEN = 'savedtok-0123456789ABCDEFabcdef';

export interface TrackedChat {
  conversationId: string;
  projectId: string;
  root: string;
  runId: string;
}

export async function chatOnBranch(
  t: TestDb,
  base: string,
  name: string,
  branch = CHAT_BRANCH,
): Promise<TrackedChat> {
  const { root } = await repoWithRemote(base, name);
  git(root, 'remote', 'set-url', 'origin', `https://github.com/acme/${name}.git`);
  git(root, 'checkout', '-qb', branch);
  const linked = await linkedConversation(t, root);
  await insertChatWorktree(t.db, {
    id: randomUUID(),
    conversationId: linked.conversationId,
    projectId: linked.projectId,
    repoRoot: root,
    path: root,
    branch,
    baseBranch: 'main',
    baseCommit: 'a'.repeat(40),
    landedCommit: null,
    inPlace: false,
    ownsBranch: true,
  });
  const runId = await sendDo(t, linked.conversationId, 'Tidy the notes and open a PR');
  return { ...linked, root, runId };
}

export async function agentOpens(t: TestDb, chat: TrackedChat, url: string): Promise<void> {
  const recorder = createTaskRecorder(t.db, chat.runId, 'Tidy the notes', async () => null);
  await recorder.observe({ kind: 'step_started', name: 'gh pr create', tool: true });
  await recorder.observe({ kind: 'link', url, title: null, source: 'tool_output' } as never);
}

export async function connectToken(t: TestDb, secrets: SecretStore): Promise<void> {
  await secrets.set('github', SAVED_TOKEN);
  await saveGitHubToken(t.db, t.workspaceId, {
    host: 'github.com',
    login: TOKEN_LOGIN,
    scopes: ['repo'],
    expiresAt: null,
    repos: [],
  });
}

export function gitHubDeps(t: TestDb, stub: GitHubStub, secrets: SecretStore): GitHubDeps {
  return {
    db: t.db,
    workspaceId: t.workspaceId,
    secrets,
    runCommand: async () => ({ code: 1, stdout: '', stderr: 'gh missing', timedOut: false }),
    locateGh: async () => null,
    fetch,
    apiUrl: stub.url,
  };
}

export function pollDeps(t: TestDb, stub: GitHubStub, secrets: SecretStore): FollowUpDeps {
  return {
    db: t.db,
    github: { secrets, runCommand, locateGh: async () => null, fetch, apiUrl: stub.url },
    branchPrefix: 'spark',
    startRound: async () => {
      throw new Error('No fix round is expected in this test.');
    },
  };
}

export function addPull(stub: GitHubStub, number: number, fields: Partial<FakePull> = {}) {
  const repo = fields.repo ?? 'widgets';
  const pull: FakePull = {
    number,
    owner: 'acme',
    repo,
    title: `Change ${number}`,
    body: '',
    head: CHAT_BRANCH,
    base: 'main',
    draft: false,
    state: 'open',
    html_url: `https://github.com/acme/${repo}/pull/${number}`,
    openedBy: TOKEN_LOGIN,
    via: 'token',
    ...fields,
  };
  stub.github.pulls.push(pull);
  return pull;
}

export const check = (id: number, name: string, status: string, conclusion: string | null) => ({
  id,
  name,
  status,
  conclusion,
  html_url: `https://github.com/acme/widgets/actions/runs/${id}`,
});

export async function tracked(t: TestDb, conversationId: string): Promise<TrackedPull[]> {
  const pulls = await trackedPullsOf(t.db, t.workspaceId, conversationId);
  return pulls.toSorted((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number);
}

export async function audited(t: TestDb, conversationId: string) {
  const { rows } = await t.db.query<{ method: string; payload: Record<string, unknown> }>(
    `SELECT l.method, l.payload FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
     WHERE r.conversation_id = $1 AND l.method IN ('ship/agent_pr', 'ship/pr_tracked')
     ORDER BY l.at, l.seq`,
    [conversationId],
  );
  return rows;
}
