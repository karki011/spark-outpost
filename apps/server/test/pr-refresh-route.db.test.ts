import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prRefreshResultSchema } from '@spark-outpost/contracts';
import { startPrFollowUp, type PrFollowUp } from '../src/pr-follow-up/poller.ts';
import { pullRefresher } from '../src/pr-tracking/refresh.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import {
  addPull,
  agentOpens,
  chatOnBranch,
  connectToken,
  pollDeps,
  tracked,
  type TrackedChat,
} from './pr-tracking-support.ts';
import { startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let secrets: SecretStore;
let chat: TrackedChat;
let poller: PrFollowUp | null;
let app: ReturnType<typeof createTestApp>;

const WIDGETS_7 = 'https://github.com/acme/widgets/pull/7';

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-pr-refresh-')));
  stub = await startGitHubStub();
  secrets = memorySecretStore();
  chat = await chatOnBranch(t, base, 'widgets');
  await agentOpens(t, chat, WIDGETS_7);
  poller = null;
  app = createTestApp(t, { secrets, fetch, githubApiUrl: stub.url });
});

afterEach(async () => {
  await poller?.stop();
  await stub.close();
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

const startPoller = () => {
  poller = startPrFollowUp(pollDeps(t, stub, secrets), 20);
};

async function watchId(): Promise<string> {
  return (await tracked(t, chat.conversationId))[0]!.id;
}

const press = (conversationId: string, id: string) =>
  request(app)
    .post(`/api/conversations/${conversationId}/pull-requests/${id}/refresh`)
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .send({});

async function stopped(state: 'closed' | 'merged'): Promise<void> {
  await t.db.query(
    `UPDATE pr_watches SET pr_state = $1, phase = 'done', last_polled_at = now(),
       next_poll_at = now() + interval '1 day'`,
    [state],
  );
}

const pullReads = () =>
  stub.github.requests.filter((entry) => entry.path === '/repos/acme/widgets/pulls/7').length;

describe('refreshing one pull request on demand', () => {
  it('reads a pull request Spark had stopped checking and shows it open again', async () => {
    await connectToken(t, secrets);
    addPull(stub, 7, { title: 'Tidy the notes', additions: 2303, deletions: 1 });
    await stopped('merged');
    startPoller();

    const response = await press(chat.conversationId, await watchId()).expect(200);
    const result = prRefreshResultSchema.parse(response.body);
    expect(result.problem).toBeNull();
    expect(result.watches[0]).toMatchObject({
      prState: 'open',
      phase: 'watching',
      title: 'Tidy the notes',
      base: 'main',
      additions: 2303,
      deletions: 1,
    });
  });

  it('reads a merged pull request once and leaves it stopped', async () => {
    await connectToken(t, secrets);
    addPull(stub, 7, { state: 'closed', merged: true, title: 'Renamed since' });
    await stopped('merged');
    startPoller();

    const response = await press(chat.conversationId, await watchId()).expect(200);
    expect(prRefreshResultSchema.parse(response.body).watches[0]).toMatchObject({
      prState: 'merged',
      phase: 'done',
      title: 'Renamed since',
      nextPollAt: null,
    });
    const reads = pullReads();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(pullReads()).toBe(reads);
  });

  it('answers several presses at once with one read', async () => {
    await connectToken(t, secrets);
    addPull(stub, 7);
    await stopped('closed');
    const id = await watchId();
    startPoller();

    const answers = await Promise.all([
      press(chat.conversationId, id),
      press(chat.conversationId, id),
      press(chat.conversationId, id),
    ]);
    for (const answer of answers) {
      expect(prRefreshResultSchema.parse(answer.body).watches[0]!.prState).toBe('open');
    }
    expect(pullReads()).toBe(1);
  });

  it('says why when GitHub is not connected, and keeps the state it had', async () => {
    addPull(stub, 7);
    await stopped('closed');
    startPoller();

    const response = await press(chat.conversationId, await watchId()).expect(200);
    const result = prRefreshResultSchema.parse(response.body);
    expect(result.problem).toBe('not_connected');
    expect(result.watches[0]!.prState).toBe('closed');
  });

  it('says there was no answer when nothing picks the request up', async () => {
    const outcome = await pullRefresher(t.db, 300).refresh({
      workspaceId: t.workspaceId,
      conversationId: chat.conversationId,
      watchId: await watchId(),
    });
    expect(outcome).toEqual({ found: true, problem: 'no_answer' });
  });

  it('refuses a pull request that is not in the chat', async () => {
    await press(randomUUID(), await watchId()).expect(404);
    await press(chat.conversationId, randomUUID()).expect(404);
  });
});
