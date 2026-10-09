import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parentNotPushedLine } from '../src/orchestration/agent-publish.ts';
import { pullBaseLine } from '../src/orchestration/context.ts';
import { primaryChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import {
  NORMAL,
  connectProviders,
  driveToEnd,
  jevFetch,
  startOrchestrator,
  startScenario,
  type Harness,
} from './orchestration-support.ts';
import { FAKE_GH, git, repoWithRemote, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { dependOn, ownedWorktree, projectChat } from './stack-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const API = 'spark/orders-endpoint-1a2b3c4d';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let harness: Harness | null = null;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-stacked-publish-')));
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = path.join(base, 'gh-state');
  await writeFile(path.join(base, 'gh-state'), 'octo-cli');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  stub = await startGitHubStub();
  process.env.FAKE_GH_API = stub.url;
  await connectProviders(t);
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: NORMAL }), {
    shipAccess: {
      secrets: memorySecretStore(),
      runCommand,
      fetch,
      apiUrl: stub.url,
      locateGh: async () => FAKE_GH,
    },
  });
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await stub.close();
  await t.cleanup();
});

async function stackOnApi(root: string, web: string, pushed: boolean): Promise<void> {
  const { rows } = await t.db.query<{ project_id: string }>(
    'SELECT project_id FROM conversation_projects WHERE conversation_id = $1',
    [web],
  );
  const projectId = rows[0]!.project_id;
  const api = await projectChat(t, projectId);
  await dependOn(t, api, web);
  git(root, 'branch', API, 'main');
  if (pushed) git(root, 'push', '-q', 'origin', API);
  await ownedWorktree(t, { conversationId: api, projectId, root }, API, 'main');
}

async function drive(name: string, pushed: boolean) {
  const repo = await repoWithRemote(base, name);
  const started = await startScenario(
    t,
    repo.root,
    NORMAL,
    'full-auto',
    'auto',
    'sonnet',
    undefined,
    (web) => stackOnApi(repo.root, web, pushed),
  );
  const { orchestration } = await driveToEnd(
    t,
    started.conversationId,
    started.runId,
    undefined,
    90_000,
  );
  expect(orchestration.status).toBe('succeeded');
  const copy = (await primaryChatWorktree(t.db, started.conversationId))!;
  const { rows: publishes } = await t.db.query<{ follow_up: string }>(
    `SELECT route->>'followUp' AS follow_up FROM runs
     WHERE parent_run_id = $1 AND route->>'followUp' LIKE '## Publish this change%'`,
    [started.runId],
  );
  const detail = (await getConversationDetail(t.db, started.conversationId))!;
  const reply = detail.messages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content)
    .join('\n');
  return { repo, copy, publishes, reply };
}

describe('a stacked chat at Full auto → PR', { timeout: 120_000 }, () => {
  it("opens its pull request against the parent chat's branch", async () => {
    const { repo, copy, publishes } = await drive('stacked', true);
    expect(copy.baseBranch).toBe(API);
    expect(publishes).toHaveLength(1);
    expect(publishes[0]!.follow_up).toContain(pullBaseLine(API));
    expect(stub.github.pulls).toHaveLength(1);
    expect(stub.github.pulls[0]).toMatchObject({ head: copy.branch, base: API });
    expect(git(repo.bare, 'branch', '--list')).toContain(copy.branch);
  });

  it('publishes nothing and says what it waits for while the parent branch is not pushed', async () => {
    const { repo, copy, publishes, reply } = await drive('unpushed', false);
    expect(copy.baseBranch).toBe(API);
    expect(publishes).toEqual([]);
    expect(stub.github.pulls).toEqual([]);
    expect(git(repo.bare, 'branch', '--list')).not.toContain(copy.branch);
    expect(reply).toContain(parentNotPushedLine({ branch: API, owner: '@api' }));
    expect(reply).toContain("Needs you: @api's branch is not pushed.");
  });
});
