import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listConversations } from '../src/persistence/conversations.ts';
import type { TrackedPull } from '../src/persistence/tracked-pulls.ts';
import type { FollowUpDeps } from '../src/pr-follow-up/deps.ts';
import { pollDue } from '../src/pr-follow-up/poller.ts';
import { conversationWatches } from '../src/pr-follow-up/view.ts';
import { chatPullRefresher } from '../src/pr-tracking/refresh.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import {
  addPull,
  agentOpens,
  check,
  chatOnBranch,
  connectToken,
  gitHubDeps,
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
let clock: number;

const GADGETS_3 = 'https://github.com/acme/gadgets/pull/3';
const WIDGETS_7 = 'https://github.com/acme/widgets/pull/7';

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-pr-reopened-')));
  stub = await startGitHubStub();
  secrets = memorySecretStore();
  chat = await chatOnBranch(t, base, 'widgets');
  clock = Date.now();
  await connectToken(t, secrets);
});

afterEach(async () => {
  await stub.close();
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

const deps = (): FollowUpDeps => ({ ...pollDeps(t, stub, secrets), now: () => new Date(clock) });

async function pollLater(): Promise<TrackedPull[]> {
  clock += 31 * 60_000;
  await pollDue(deps());
  return tracked(t, chat.conversationId);
}

const pullReads = (repo: string, number: number) =>
  stub.github.requests.filter((request) => request.path === `/repos/acme/${repo}/pulls/${number}`)
    .length;

describe('a pull request that was closed and then reopened', () => {
  it('shows as open again, with its checks, once GitHub says it is open', async () => {
    await agentOpens(t, chat, GADGETS_3);
    const pull = addPull(stub, 3, { repo: 'gadgets', head: 'fix-docs', state: 'closed' });
    expect((await pollLater())[0]).toMatchObject({ prState: 'closed', phase: 'done' });

    pull.state = 'open';
    pull.checks = [check(1, 'test', 'completed', 'success')];
    expect((await pollLater())[0]).toMatchObject({
      prState: 'open',
      phase: 'watching',
      checks: 'passing',
      doing: 'Tracking checks and reviews.',
    });
    const [view] = await conversationWatches(t.db, t.workspaceId, chat.conversationId);
    expect(view).toMatchObject({ prState: 'open', phase: 'watching' });
    expect(view!.nextPollAt).not.toBeNull();
  });

  it('is watched again on the chat’s own branch, which brings back the standing permission', async () => {
    await agentOpens(t, chat, WIDGETS_7);
    const pull = addPull(stub, 7, { state: 'closed' });
    expect((await pollLater())[0]).toMatchObject({
      prState: 'closed',
      phase: 'done',
      followUp: true,
    });

    pull.state = 'open';
    expect((await pollLater())[0]).toMatchObject({
      prState: 'open',
      phase: 'watching',
      followUp: true,
      doing: 'Watching checks and reviews.',
    });
  });

  it('keeps being checked while closed, at the slowest pace, and says so', async () => {
    await agentOpens(t, chat, GADGETS_3);
    addPull(stub, 3, { repo: 'gadgets', head: 'fix-docs', state: 'closed' });
    const [closed] = await pollLater();
    expect(closed).toMatchObject({
      intervalSeconds: 1800,
      doing: 'The PR was closed. Spark picks it up again if it is reopened.',
    });
    const reads = pullReads('gadgets', 3);
    await pollLater();
    expect(pullReads('gadgets', 3)).toBe(reads + 1);
  });

  it('is read again when you come back to the chat', async () => {
    await agentOpens(t, chat, GADGETS_3);
    addPull(stub, 3, { repo: 'gadgets', head: 'fix-docs', state: 'closed' });
    await pollLater();
    await t.db.query(
      `UPDATE pr_watches SET next_poll_at = now() + interval '1 hour',
         last_polled_at = now() - interval '1 minute'`,
    );
    await chatPullRefresher(gitHubDeps(t, stub, secrets)).refresh(chat.conversationId);
    const [pull] = await tracked(t, chat.conversationId);
    expect(pull!.nextPollAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('no longer marks the chat as merged in the sidebar', async () => {
    await agentOpens(t, chat, GADGETS_3);
    await agentOpens(t, chat, WIDGETS_7);
    addPull(stub, 3, { repo: 'gadgets', head: 'fix-docs', state: 'closed', merged: true });
    const pull = addPull(stub, 7, { state: 'closed' });
    await pollLater();
    const merged = async () =>
      (await listConversations(t.db, t.workspaceId)).find(
        (entry) => entry.id === chat.conversationId,
      )!.pullRequestMerged;
    expect(await merged()).toBe(true);

    pull.state = 'open';
    await pollLater();
    expect(await merged()).toBe(false);
  });
});
