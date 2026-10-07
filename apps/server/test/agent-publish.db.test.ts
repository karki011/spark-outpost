import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { primaryChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { HARNESS_COMMIT_EMAIL } from '../src/projects/snapshot.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { PUSHED_WITHOUT_PR } from '../src/ship/published.ts';
import { PIECE_CHECK_SCRIPT } from './fake-acp-coordinator.ts';
import {
  NORMAL,
  connectProviders,
  driveToEnd,
  jevFetch,
  startOrchestrator,
  startScenario,
  withTag,
  type Harness,
  type Scenario,
} from './orchestration-support.ts';
import { FAKE_GH, git, repoWithRemote, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let harness: Harness | null = null;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-agent-publish-')));
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = path.join(base, 'gh-state');
  await writeFile(path.join(base, 'gh-state'), 'octo-cli');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

function start(crew = false) {
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: NORMAL }), {
    ...(crew ? { coordinator: 'parallel' as const } : {}),
    shipAccess: {
      secrets: memorySecretStore(),
      runCommand,
      fetch,
      apiUrl: stub.url,
      locateGh: async () => FAKE_GH,
    },
  });
}

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  stub = await startGitHubStub();
  process.env.FAKE_GH_API = stub.url;
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await stub.close();
  await t.cleanup();
});

async function finalReply(conversationId: string): Promise<string> {
  const detail = (await getConversationDetail(t.db, conversationId))!;
  return detail.messages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content)
    .join('\n');
}

async function publishRuns(runId: string) {
  const { rows } = await t.db.query<{ role: string; follow_up: string | null }>(
    `SELECT role, route->>'followUp' AS follow_up FROM runs
     WHERE parent_run_id = $1 AND route->>'followUp' LIKE '## Publish this change%'`,
    [runId],
  );
  return rows;
}

async function drive(name: string, scenario: Scenario, level: 'hands-off' | 'full-auto') {
  const repo = await repoWithRemote(base, name);
  const started = await startScenario(t, repo.root, scenario, level);
  const { orchestration } = await driveToEnd(
    t,
    started.conversationId,
    started.runId,
    undefined,
    90_000,
  );
  expect(orchestration.status).toBe('succeeded');
  const copy = (await primaryChatWorktree(t.db, started.conversationId))!;
  return { ...started, repo, copy };
}

const ASKED = withTag(NORMAL, 'lets take it all the way to PR');

describe('who publishes at the end of a turn', { timeout: 120_000 }, () => {
  it('Full auto → PR: the Builder pushes and opens the pull request, and Spark records it', async () => {
    start();
    const { conversationId, runId, repo, copy } = await drive('full-auto', NORMAL, 'full-auto');
    expect(stub.github.pulls).toHaveLength(1);
    expect(stub.github.pulls[0]).toMatchObject({
      head: copy.branch,
      base: 'main',
      via: 'gh_cli',
    });
    expect(await publishRuns(runId)).toEqual([expect.objectContaining({ role: 'builder' })]);
    const authors = git(repo.bare, 'log', '--format=%ae', copy.branch).split('\n');
    expect(authors).toContain('agent@example.test');
    expect(authors).not.toContain(HARNESS_COMMIT_EMAIL);
    expect(await finalReply(conversationId)).toContain(
      'Opened pull request #1: https://github.com/acme/widgets/pull/1',
    );
    const { rows } = await t.db.query<{ number: number; branch: string }>(
      'SELECT number, branch FROM pr_watches WHERE conversation_id = $1',
      [conversationId],
    );
    expect(rows).toEqual([{ number: 1, branch: copy.branch }]);
  });

  it('a request that asks for a pull request ends with one publish turn at Automatic', async () => {
    start();
    const { conversationId, runId, copy } = await drive('asked', ASKED, 'hands-off');
    expect(await publishRuns(runId)).toHaveLength(1);
    expect(stub.github.pulls).toHaveLength(1);
    expect(stub.github.pulls[0]).toMatchObject({ head: copy.branch });
    expect(await finalReply(conversationId)).toContain('Opened pull request #1');
  });

  it('a request that does not ask stays unpublished at Automatic', async () => {
    start();
    const { runId, repo, copy } = await drive('quiet', NORMAL, 'hands-off');
    expect(await publishRuns(runId)).toEqual([]);
    expect(stub.github.pulls).toEqual([]);
    expect(git(repo.bare, 'branch', '--list')).not.toContain(copy.branch);
  });

  it('a crew turn publishes exactly once, by the integrator after the pieces land', async () => {
    start(true);
    const repo = await repoWithRemote(base, 'crew');
    await writeFile(path.join(repo.root, 'piece-check.mjs'), PIECE_CHECK_SCRIPT);
    git(repo.root, 'add', '.');
    git(repo.root, 'commit', '-qm', 'piece check');
    git(repo.root, 'push', '-q', 'origin', 'main');
    const scenario = withTag(
      NORMAL,
      'Split this up and lets take it all the way to PR. #pieces #parallel #heredoc',
    );
    const started = await startScenario(
      t,
      repo.root,
      scenario,
      'hands-off',
      'auto',
      'sonnet',
      'acceptEdits',
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
    const publishes = await publishRuns(started.runId);
    expect(publishes).toHaveLength(1);
    expect(publishes[0]!.role).toBe('integrator');
    expect(stub.github.pulls).toHaveLength(1);
    const shipped = git(repo.bare, 'diff', '--name-only', 'main', copy.branch).split('\n');
    expect(shipped).toEqual(expect.arrayContaining(['store.ts', 'api.ts', 'view.ts']));
  });

  it('says the branch was pushed without a pull request, with the link to create one', async () => {
    start();
    const { conversationId, repo, copy } = await drive(
      'no-pr',
      withTag(ASKED, '#nopr'),
      'hands-off',
    );
    expect(stub.github.pulls).toEqual([]);
    expect(git(repo.bare, 'branch', '--list')).toContain(copy.branch);
    const reply = await finalReply(conversationId);
    expect(reply).toContain(PUSHED_WITHOUT_PR);
    expect(reply).toContain(
      `https://github.com/acme/widgets/compare/main...${encodeURIComponent(copy.branch)}`,
    );
  });

  it('says plainly when nothing was pushed, with what the agent reported', async () => {
    start();
    const { conversationId, repo, copy } = await drive(
      'no-push',
      withTag(ASKED, '#nopush'),
      'hands-off',
    );
    expect(git(repo.bare, 'branch', '--list')).not.toContain(copy.branch);
    const reply = await finalReply(conversationId);
    expect(reply).toContain(`${copy.branch} was not pushed to acme/widgets`);
    expect(reply).toContain('published=no reason=asked not to push');
  });
});
