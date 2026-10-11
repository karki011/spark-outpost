import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { updateConversation } from '../src/persistence/conversation-actions.ts';
import { getSummary } from '../src/persistence/conversations.ts';
import type { Provider, ProviderOutput } from '../src/providers/provider.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import type { Worker } from '../src/workflow/worker.ts';
import {
  FAKE_GH,
  repoWithRemote,
  startGitHubStub,
  type GitHubStub,
  type TestRepo,
} from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { driveToEnd, openChat, repliesOf, sendMessage } from './turn-support.ts';
import { connectAgents, fakeAgents, startTurnWorker } from './turn-worker.ts';

const BUILD = 'The divider shows the wrong day after midnight. Fix it. #build';

let t: TestDb;
let base: string;
let repo: TestRepo;
let stub: GitHubStub;
let worker: Worker;
let repos = 0;
let titled = 0;

let opensWithTitle = false;

async function* planWithOpeningTitle(): AsyncGenerator<ProviderOutput> {
  yield { kind: 'text_delta', delta: '\n\nI will read the code, then plan.', phase: 'commentary' };
  yield {
    kind: 'text_delta',
    delta: '\n\nTitle: Plan the mean function\n\n# Plan\nAdd mean to sum.js with a test.',
    phase: 'final',
  };
}

function withTitleHabit(agent: Provider): Provider {
  return {
    name: agent.name,
    async *run(turn) {
      yield* agent.run(turn);
      if (opensWithTitle) return yield* planWithOpeningTitle();
      titled += 1;
      yield { kind: 'text_delta', delta: `\n\nTitle: Habit title ${titled}` };
    },
  };
}

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-title-habit-')));
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = path.join(base, 'gh-state');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  stub = await startGitHubStub();
  process.env.FAKE_GH_API = stub.url;
  await writeFile(path.join(base, 'gh-state'), 'octo-cli');
  repos += 1;
  titled = 0;
  opensWithTitle = false;
  repo = await repoWithRemote(base, `widgets-${repos}`);
  await connectAgents(t);
  const agents = fakeAgents({ sessions: path.join(base, `sessions-${repos}`) });
  worker = startTurnWorker(t, {
    providers: new Map([...agents].map(([id, agent]) => [id, withTitleHabit(agent)])),
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
  await worker.stop();
  await stub.close();
  await t.cleanup();
});

async function suggestedTitle(runId: string): Promise<string | null> {
  const { rows } = await t.db.query<{ suggested_title: string | null }>(
    'SELECT suggested_title FROM runs WHERE id = $1',
    [runId],
  );
  return rows[0]!.suggested_title;
}

describe('an agent that ends every reply with a title line, asked or not', () => {
  it('has the line hidden in the work reply and in the publish reply, and titles the chat once', async () => {
    const conversationId = await openChat(t, { root: repo.root, level: 'full-auto' });
    const runId = await sendMessage(t, conversationId, BUILD, {
      permission: 'do',
      level: 'full-auto',
    });
    const { run } = await driveToEnd(t, conversationId, runId);

    expect(run.status).toBe('succeeded');
    const replies = await repliesOf(t, runId);
    expect(replies).toHaveLength(2);
    expect(replies.join('\n')).not.toMatch(/Title:/);
    expect(await suggestedTitle(runId)).toBe('Habit title 1');
    expect(await getSummary(t.db, conversationId)).toMatchObject({
      title: 'Habit title 1',
      titleSource: 'auto',
    });
  });

  it('has the line hidden in a chat the user renamed, and keeps the name', async () => {
    const conversationId = await openChat(t, { root: repo.root, level: 'hands-off' });
    await updateConversation(t.db, t.workspaceId, conversationId, { title: 'My name' });
    const runId = await sendMessage(t, conversationId, 'What does the divider do?');
    await driveToEnd(t, conversationId, runId);

    const replies = await repliesOf(t, runId);
    expect(replies).toHaveLength(1);
    expect(replies[0]).not.toMatch(/Title:/);
    expect(await suggestedTitle(runId)).toBeNull();
    expect(await getSummary(t.db, conversationId)).toMatchObject({
      title: 'My name',
      titleSource: 'user',
    });
  });

  it('has a title line that opens the final message hidden, after the commentary before it', async () => {
    opensWithTitle = true;
    const conversationId = await openChat(t, { root: repo.root, level: 'hands-off' });
    const runId = await sendMessage(t, conversationId, 'Plan a mean function.');
    await driveToEnd(t, conversationId, runId);

    const [reply] = await repliesOf(t, runId);
    expect(reply).not.toContain('Title: Plan the mean function');
    expect(reply).toMatch(
      /I will read the code, then plan\.\n\n# Plan\nAdd mean to sum\.js with a test\.$/,
    );
    expect(await suggestedTitle(runId)).toBe('Plan the mean function');
  });
});
