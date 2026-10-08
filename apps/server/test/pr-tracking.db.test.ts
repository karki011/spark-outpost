import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prWatchListSchema } from '@spark-outpost/contracts';
import { watchesForConversation } from '../src/persistence/pr-watches.ts';
import { conversationWatches } from '../src/pr-follow-up/view.ts';
import { discoverChatPullRequests } from '../src/pr-tracking/discover.ts';
import { chatPullRefresher } from '../src/pr-tracking/refresh.ts';
import { trackTerminalPull } from '../src/pr-tracking/terminal.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { taskBranch } from '../src/workflow/publish-context.ts';
import {
  addPull,
  agentOpens,
  audited,
  CHAT_BRANCH,
  chatOnBranch,
  connectToken,
  gitHubDeps,
  tracked,
} from './pr-tracking-support.ts';
import { git, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let secrets: SecretStore;

const WIDGETS_7 = 'https://github.com/acme/widgets/pull/7';
const WIDGETS_8 = 'https://github.com/acme/widgets/pull/8';
const GADGETS_3 = 'https://github.com/acme/gadgets/pull/3';
const TAB_OPENED = new Date('2026-10-05T10:00:00Z');

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-pr-tracking-')));
  stub = await startGitHubStub();
  secrets = memorySecretStore();
});

afterEach(async () => {
  await stub.close();
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

const deps = () => gitHubDeps(t, stub, secrets);

describe('pull requests an agent opens in a chat', () => {
  it('tracks two on the same repo, each with who opened it and in which run', async () => {
    const chat = await chatOnBranch(t, base, 'widgets');
    await agentOpens(t, chat, WIDGETS_7);
    await agentOpens(t, chat, WIDGETS_8);
    await agentOpens(t, chat, WIDGETS_8);

    const pulls = await tracked(t, chat.conversationId);
    expect(pulls.map((pull) => pull.number)).toEqual([7, 8]);
    expect(pulls[0]).toMatchObject({
      openedVia: 'agent',
      openedBy: 'fake',
      openedRunId: chat.runId,
      outside: false,
      branch: CHAT_BRANCH,
      followUp: true,
    });
    const entries = await audited(t, chat.conversationId);
    expect(entries.map((entry) => entry.payload.number)).toEqual([7, 8]);
    expect(entries[0]).toMatchObject({
      method: 'ship/agent_pr',
      payload: { outcome: 'opened', via: 'agent_command', by: 'fake', watched: true },
    });
  });

  it('tracks one in another repo as outside, without following up on it', async () => {
    const chat = await chatOnBranch(t, base, 'widgets');
    await agentOpens(t, chat, WIDGETS_7);
    await agentOpens(t, chat, GADGETS_3);

    const [gadgets, widgets] = await tracked(t, chat.conversationId);
    expect(gadgets).toMatchObject({ repo: 'gadgets', number: 3, outside: true, followUp: false });
    expect(widgets).toMatchObject({ repo: 'widgets', number: 7, outside: false, followUp: true });
    const followed = await watchesForConversation(t.db, t.workspaceId, chat.conversationId);
    expect(followed.map((watch) => watch.url)).toEqual([WIDGETS_7]);
    expect((await audited(t, chat.conversationId)).at(-1)!.payload).toMatchObject({
      repo: 'acme/gadgets',
      outside: true,
      watched: false,
    });
  });

  it('keeps one row when the same pull request is seen with different letter case', async () => {
    const chat = await chatOnBranch(t, base, 'widgets');
    await agentOpens(t, chat, WIDGETS_7);
    await agentOpens(t, chat, 'https://github.com/Acme/Widgets/pull/7');
    expect(await tracked(t, chat.conversationId)).toHaveLength(1);
    expect(await audited(t, chat.conversationId)).toHaveLength(1);
  });
});

describe('a pull request opened from the chat’s terminal tab', () => {
  const sighting = (conversationId: string, url: string) => ({
    conversationId,
    url,
    shellOpenedAt: TAB_OPENED,
  });

  it('is tracked when it comes from the branch the chat works on', async () => {
    const chat = await chatOnBranch(t, base, 'widgets');
    await connectToken(t, secrets);
    addPull(stub, 2198, { title: 'Tidy the notes', created_at: '2026-09-01T09:00:00Z' });
    const url = 'https://github.com/acme/widgets/pull/2198';

    const first = await trackTerminalPull(deps(), sighting(chat.conversationId, url));
    expect(first).toMatchObject({ created: true });
    expect(await trackTerminalPull(deps(), sighting(chat.conversationId, url))).toBeNull();

    expect(await tracked(t, chat.conversationId)).toMatchObject([
      {
        number: 2198,
        title: 'Tidy the notes',
        branch: CHAT_BRANCH,
        base: 'main',
        openedVia: 'terminal',
        openedBy: 'terminal',
        openedRunId: null,
        outside: false,
      },
    ]);
    expect(await audited(t, chat.conversationId)).toMatchObject([
      { method: 'ship/pr_tracked', payload: { via: 'terminal', number: 2198, outcome: 'opened' } },
    ]);
  });

  it('is tracked in another repo when you opened it while the tab was open', async () => {
    const chat = await chatOnBranch(t, base, 'widgets');
    await connectToken(t, secrets);
    addPull(stub, 3, { repo: 'gadgets', head: 'fix-docs', created_at: '2026-10-05T10:05:00Z' });

    await trackTerminalPull(deps(), sighting(chat.conversationId, GADGETS_3));
    expect(await tracked(t, chat.conversationId)).toMatchObject([
      { repo: 'gadgets', number: 3, outside: true, followUp: false, branch: 'fix-docs' },
    ]);
  });

  it('is left alone when the tab only printed someone else’s older pull request', async () => {
    const chat = await chatOnBranch(t, base, 'widgets');
    await connectToken(t, secrets);
    addPull(stub, 41, {
      head: 'their-branch',
      openedBy: 'mona',
      created_at: '2026-10-05T10:05:00Z',
    });
    addPull(stub, 42, { head: 'old-branch', created_at: '2026-09-01T09:00:00Z' });

    for (const number of [41, 42]) {
      const url = `https://github.com/acme/widgets/pull/${number}`;
      expect(await trackTerminalPull(deps(), sighting(chat.conversationId, url))).toBeNull();
    }
    expect(await tracked(t, chat.conversationId)).toEqual([]);
  });

  it('is not tracked when GitHub is not connected', async () => {
    const chat = await chatOnBranch(t, base, 'widgets');
    addPull(stub, 7);
    expect(await trackTerminalPull(deps(), sighting(chat.conversationId, WIDGETS_7))).toBeNull();
  });
});

describe('discovering the pull requests of a chat', () => {
  it('finds pull requests whose head is the chat’s branch and records them once', async () => {
    const chat = await chatOnBranch(t, base, 'widgets');
    await connectToken(t, secrets);
    addPull(stub, 7, { title: 'Tidy the notes', draft: true });
    addPull(stub, 9, { head: 'someone-elses-branch' });

    const found = await discoverChatPullRequests(deps(), chat.conversationId);
    expect(found).toEqual([
      {
        url: WIDGETS_7,
        number: 7,
        owner: 'acme',
        repo: 'widgets',
        state: 'draft',
        branch: CHAT_BRANCH,
        base: 'main',
        title: 'Tidy the notes',
        checks: 'none',
        outside: false,
        openedVia: 'discovery',
      },
    ]);
    expect(await discoverChatPullRequests(deps(), chat.conversationId)).toHaveLength(1);
    expect(await audited(t, chat.conversationId)).toMatchObject([
      { method: 'ship/pr_tracked', payload: { via: 'discovery', outcome: 'found', number: 7 } },
    ]);
  });

  it("makes a pull request found on the chat's branch the chat's own for the publish rules", async () => {
    const chat = await chatOnBranch(t, base, 'widgets');
    await connectToken(t, secrets);
    addPull(stub, 7);
    expect((await taskBranch(t.db, chat.root))?.pull).toBeNull();

    await discoverChatPullRequests(deps(), chat.conversationId);
    expect(await taskBranch(t.db, chat.root)).toMatchObject({ branch: CHAT_BRANCH, pull: 7 });
  });

  it('also looks at a branch checked out in the worktree, and keeps what the agent recorded', async () => {
    const chat = await chatOnBranch(t, base, 'widgets');
    await connectToken(t, secrets);
    await agentOpens(t, chat, WIDGETS_7);
    addPull(stub, 7);
    addPull(stub, 8, { head: 'feature/side-quest' });
    git(chat.root, 'checkout', '-qb', 'feature/side-quest');

    const found = await discoverChatPullRequests(deps(), chat.conversationId);
    expect(found.map((pull) => [pull.number, pull.openedVia]).toSorted()).toEqual([
      [7, 'agent'],
      [8, 'discovery'],
    ]);
    const side = (await tracked(t, chat.conversationId)).find((pull) => pull.number === 8)!;
    expect(side).toMatchObject({ branch: 'feature/side-quest', followUp: false });
  });

  it('returns what is already tracked when GitHub is not connected', async () => {
    const chat = await chatOnBranch(t, base, 'widgets');
    await agentOpens(t, chat, WIDGETS_7);
    const found = await discoverChatPullRequests(deps(), chat.conversationId);
    expect(found.map((pull) => pull.url)).toEqual([WIDGETS_7]);
    expect(stub.github.requests).toEqual([]);
  });

  it('is asked again on focus only after a pause, and wakes stale pull requests', async () => {
    const chat = await chatOnBranch(t, base, 'widgets');
    await connectToken(t, secrets);
    addPull(stub, 7);
    let now = Date.parse('2026-10-05T10:00:00Z');
    const refresher = chatPullRefresher(deps(), () => now);
    const lists = () =>
      stub.github.requests.filter((request) => request.path === '/repos/acme/widgets/pulls').length;

    await refresher.refresh(chat.conversationId);
    await refresher.refresh(chat.conversationId);
    expect(lists()).toBe(1);
    now += 61_000;
    await refresher.refresh(chat.conversationId);
    expect(lists()).toBe(2);

    await t.db.query(
      `UPDATE pr_watches SET next_poll_at = now() + interval '1 hour', last_polled_at = $1`,
      [new Date(now - 60_000)],
    );
    await refresher.refresh(chat.conversationId);
    const [pull] = await tracked(t, chat.conversationId);
    expect(pull!.nextPollAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('rows written before pull request tracking', () => {
  it('still render, as pull requests Spark follows up on', async () => {
    const chat = await chatOnBranch(t, base, 'widgets');
    await agentOpens(t, chat, WIDGETS_7);
    await t.db.query('DELETE FROM pr_watches');
    const { rows } = await t.db.query<{ id: string }>(
      'SELECT id FROM tasks WHERE conversation_id = $1',
      [chat.conversationId],
    );
    await t.db.query(
      `INSERT INTO pr_watches (id, workspace_id, conversation_id, task_id, host, owner, repo,
         number, url, branch, doing, draft)
       VALUES (gen_random_uuid(), $1, $2, $3, 'github.com', 'acme', 'widgets', 7, $4, $5,
         'Watching checks and reviews.', false)`,
      [t.workspaceId, chat.conversationId, rows[0]!.id, WIDGETS_7, CHAT_BRANCH],
    );

    const view = await conversationWatches(t.db, t.workspaceId, chat.conversationId);
    expect(prWatchListSchema.parse({ watches: view }).watches).toMatchObject([
      {
        repo: 'acme/widgets',
        number: 7,
        title: null,
        base: null,
        outside: false,
        followUp: true,
        opened: { via: 'ship', by: null, runId: null },
        checks: 'none',
        failingChecks: [],
        review: 'none',
        unknownReason: null,
      },
    ]);
    const followed = await watchesForConversation(t.db, t.workspaceId, chat.conversationId);
    expect(followed).toHaveLength(1);
  });
});
