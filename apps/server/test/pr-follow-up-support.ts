import { randomUUID } from 'node:crypto';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { getWatch, watchPullRequest, type Watch } from '../src/persistence/pr-watches.ts';
import { getRun } from '../src/persistence/runs.ts';
import { saveTaskShip } from '../src/persistence/task-ships.ts';
import type { FollowUpDeps } from '../src/pr-follow-up/deps.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { fakeConnection, type FakeFeedbackGitHub } from './fake-github-feedback.ts';
import { git, repoWithRemote, write, type TestRepo } from './ship-support.ts';
import { eventually, type TestDb } from './support.ts';

export const PR_BRANCH = 'spark/tidy-the-notes-0a1b2c3d';
export const PR_URL = 'https://github.com/acme/widgets/pull/7';

export function startFakeWorker(t: TestDb): Worker {
  const provider = createFakeProvider({ stepMs: 0, wordMs: 0 });
  return startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    pollMs: 20,
  });
}

export async function finishedRun(t: TestDb, runId: string) {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  }, 15_000);
}

export interface OpenPull {
  repo: TestRepo;
  conversationId: string;
  taskId: string;
  watch: Watch;
  sha: string;
}

export async function openPull(t: TestDb, base: string, name: string): Promise<OpenPull> {
  const repo = await repoWithRemote(base, name);
  git(repo.root, 'switch', '-q', '-c', PR_BRANCH);
  await write(repo.root, 'notes.txt', 'one\nfirst change\n');
  git(repo.root, 'commit', '-qam', 'Tidy the notes');
  git(repo.root, 'push', '-q', 'origin', PR_BRANCH);
  const sha = git(repo.root, 'rev-parse', 'HEAD');
  const conversationId = randomUUID();
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: 'Tidy the notes #plan' },
    { provider: 'fake' },
    t.workspaceId,
  );
  await finishedRun(t, sent.run.id);
  const { rows } = await t.db.query<{ id: string }>(
    'SELECT id FROM tasks WHERE conversation_id = $1',
    [conversationId],
  );
  const taskId = rows[0]!.id;
  await saveTaskShip(t.db, taskId, {
    rootPath: repo.root,
    branch: PR_BRANCH,
    baseBranch: 'main',
    remote: 'origin',
    lastCommit: sha,
    pushedAt: new Date(),
    prUrl: PR_URL,
    prNumber: 7,
  });
  await watchPullRequest(t.db, {
    workspaceId: t.workspaceId,
    conversationId,
    taskId,
    host: 'github.com',
    owner: 'acme',
    repo: 'widgets',
    number: 7,
    url: PR_URL,
    branch: PR_BRANCH,
  });
  const { rows: watches } = await t.db.query<{ id: string }>(
    'SELECT id FROM pr_watches WHERE conversation_id = $1',
    [conversationId],
  );
  return { repo, conversationId, taskId, watch: (await getWatch(t.db, watches[0]!.id))!, sha };
}

export interface RoundCall {
  runId: string;
  content: string;
}

export function followUpDeps(t: TestDb, fake: FakeFeedbackGitHub, rounds: RoundCall[]) {
  const deps: FollowUpDeps = {
    db: t.db,
    github: {
      secrets: memorySecretStore(),
      runCommand,
      locateGh: async () => null,
      fetch,
    },
    branchPrefix: 'spark',
    connect: async () => fakeConnection(fake),
    startRound: async (watch, content) => {
      const sent = await sendUserMessage(
        t.db,
        watch.conversationId,
        { id: randomUUID(), content, source: 'pr_follow_up' },
        { provider: 'fake' },
      );
      rounds.push({ runId: sent.run.id, content });
      return sent.run.id;
    },
  };
  return deps;
}

export async function setReply(t: TestDb, runId: string, content: string): Promise<void> {
  await t.db.query("UPDATE messages SET content = $2 WHERE run_id = $1 AND role = 'assistant'", [
    runId,
    content,
  ]);
}

export async function current(t: TestDb, watch: Watch): Promise<Watch> {
  return (await getWatch(t.db, watch.id))!;
}
