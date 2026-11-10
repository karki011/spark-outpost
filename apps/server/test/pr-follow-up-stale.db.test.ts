import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { feedbackFor, prFeedbackWaiting, WATCHING_LINE } from '../src/persistence/pr-watches.ts';
import { pollWatch } from '../src/pr-follow-up/poller.ts';
import { conversationWatches } from '../src/pr-follow-up/view.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { fakeFeedbackGitHub, type FakeFeedbackGitHub } from './fake-github-feedback.ts';
import {
  PR_URL,
  current,
  followUpDeps,
  openPull,
  startFakeWorker,
  type OpenPull,
  type RoundCall,
} from './pr-follow-up-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let worker: Worker;
let fake: FakeFeedbackGitHub;
let rounds: RoundCall[];
let pull: OpenPull;

const alice = { login: 'alice' };
const codex = { login: 'chatgpt-codex-connector[bot]' };
const greptile = { login: 'greptile-apps[bot]' };

const CODEX_BODY =
  "**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub> Match email parameters against the email field**\n\nThe handlers explicitly require `user` and `users` to be email addresses, but the query filters on `USER['name']` instead.";
const GREPTILE_BODY =
  '<a href="#"><img alt="P1" src="https://greptile-static-assets.s3.amazonaws.com/badges/p1.svg" align="top"></a> **Repeated events inflate totals**\n\nCorrected events are counted twice, so totals are wrong.';

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-pr-stale-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async (context) => {
  t = await createTestDb();
  worker = startFakeWorker(t);
  pull = await openPull(t, base, context.task.id);
  fake = fakeFeedbackGitHub({ sha: pull.sha });
  rounds = [];
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
});

const poll = async () => pollWatch(followUpDeps(t, fake, rounds), await current(t, pull.watch));
const states = async () =>
  (await feedbackFor(t.db, pull.watch.id)).map((item) => [item.sourceKey, item.state]);
const view = async () => (await conversationWatches(t.db, t.workspaceId, pull.conversationId))[0]!;
const waiting = async () => prFeedbackWaiting(t.db, t.workspaceId, [PR_URL]);

async function leftForYou() {
  await t.db.query(
    `UPDATE conversations SET session_type = 'terminal', terminal_provider = 'claude' WHERE id = $1`,
    [pull.conversationId],
  );
}

const botThreads = () => [
  { id: 41, user: codex, body: CODEX_BODY, path: 'session_activity.py', line: 44 },
  { id: 42, user: greptile, body: GREPTILE_BODY, path: 'setup-template.json', line: 35 },
  {
    id: 43,
    user: alice,
    body: 'No code change needed: enriched_events already keeps one row per event, so please re-review.',
    path: 'session_activity.py',
    line: 44,
    in_reply_to_id: 41,
  },
  {
    id: 44,
    user: alice,
    body: 'Fixed in a66e841: add the missing type hints.',
    path: 'setup-template.json',
    line: 35,
    in_reply_to_id: 42,
  },
];

describe(
  'PR follow-up after the chat’s agent handled the feedback itself',
  { timeout: 60_000 },
  () => {
    it('never gathers the PR author’s own thread replies, and closes bot threads once resolved', async () => {
      fake.pull.reviewComments = botThreads();
      await poll();
      expect(await states()).toEqual([
        ['review_comment:41', 'held'],
        ['review_comment:42', 'held'],
      ]);
      expect(rounds).toEqual([]);
      expect((await view()).newComments).toBe(2);

      fake.pull.resolvedThreads = [41, 42];
      const after = await poll();
      expect(await states()).toEqual([
        ['review_comment:41', 'done'],
        ['review_comment:42', 'done'],
      ]);
      expect(after).toMatchObject({ phase: 'watching', doing: WATCHING_LINE });
      expect((await view()).newComments).toBe(0);
      expect((await view()).details.threads).toEqual([]);
    });

    it('shows bot comments as plain text with the priority badge as a word', async () => {
      fake.pull.reviewComments = botThreads();
      await poll();
      const items = (await view()).items;
      expect(items.map((item) => item.excerpt.split(' The ')[0])).toEqual([
        'P1 · Match email parameters against the email field',
        'P1 · Repeated events inflate totals Corrected events are counted twice, so totals are wrong.',
      ]);
      expect(items.every((item) => !/<|\*\*|!\[|\]\(/.test(item.excerpt))).toBe(true);
    });

    it('clears items left for the user once their thread is resolved', async () => {
      await leftForYou();
      fake.pull.reviewComments = [
        { id: 21, user: alice, body: 'Please handle the empty list.', path: 'notes.txt', line: 1 },
      ];
      const limited = await poll();
      expect(limited.phase).toBe('needs_you');
      expect(await states()).toEqual([['review_comment:21', 'needs_user']]);
      expect((await waiting()).get(PR_URL)?.waiting).toBe(1);

      fake.pull.resolvedThreads = [21];
      const after = await poll();
      expect(after).toMatchObject({ phase: 'watching', doing: WATCHING_LINE });
      expect(await states()).toEqual([['review_comment:21', 'done']]);
      expect((await waiting()).size).toBe(0);
      expect(rounds).toEqual([]);
    });

    it('keeps a closed item closed when its thread is unresolved again, and starts no round', async () => {
      fake.pull.reviewComments = [
        { id: 21, user: alice, body: 'Please handle the empty list.', path: 'notes.txt', line: 1 },
      ];
      fake.pull.resolvedThreads = [21];
      await poll();
      expect(await states()).toEqual([['review_comment:21', 'done']]);
      fake.pull.resolvedThreads = [];
      await poll();
      expect(await states()).toEqual([['review_comment:21', 'done']]);
      expect(rounds).toEqual([]);
    });

    it('changes nothing when GitHub can’t say which threads are resolved', async () => {
      await leftForYou();
      fake.pull.reviewComments = [
        { id: 21, user: alice, body: 'Please handle the empty list.', path: 'notes.txt', line: 1 },
      ];
      await poll();
      const answer = fake.request;
      fake.request = async (method, route, body) =>
        route === '/graphql'
          ? { status: 502, data: null, header: () => null }
          : answer(method, route, body);
      fake.pull.resolvedThreads = [21];
      await poll();
      expect(await states()).toEqual([['review_comment:21', 'needs_user']]);
    });

    it('closes a check left for the user once that check passes on a newer commit', async () => {
      await leftForYou();
      fake.pull.checkRuns = [{ id: 11, name: 'test', status: 'completed', conclusion: 'failure' }];
      await poll();
      expect(await states()).toEqual([[`check:test:${pull.sha}`, 'needs_user']]);

      fake.pull.sha = 'sha-2';
      fake.pull.checkRuns = [{ id: 12, name: 'test', status: 'completed', conclusion: 'success' }];
      const after = await poll();
      expect(await states()).toEqual([[`check:test:${pull.sha}`, 'done']]);
      expect(after.phase).toBe('watching');
    });

    it('keeps a check open while it still runs on the newer commit', async () => {
      await leftForYou();
      fake.pull.checkRuns = [{ id: 11, name: 'test', status: 'completed', conclusion: 'failure' }];
      await poll();
      fake.pull.sha = 'sha-2';
      fake.pull.checkRuns = [{ id: 12, name: 'test', status: 'in_progress', conclusion: null }];
      await poll();
      expect(await states()).toEqual([[`check:test:${pull.sha}`, 'needs_user']]);
    });

    it('closes a bot review once the same reviewer posts a newer one', async () => {
      fake.pull.reviews = [
        {
          id: 51,
          user: greptile,
          body: 'Confidence 3/5. Totals are wrong for corrected events.',
          state: 'COMMENTED',
        },
      ];
      await poll();
      expect(await states()).toEqual([['review:51', 'held']]);
      fake.pull.reviews.push({
        id: 52,
        user: greptile,
        body: 'Confidence 4/5. Please add a test for the empty list.',
        state: 'COMMENTED',
      });
      await poll();
      expect(await states()).toEqual([
        ['review:51', 'done'],
        ['review:52', 'held'],
      ]);
    });

    it('keeps a writer’s review request open when they comment again, until they approve', async () => {
      await leftForYou();
      fake.pull.reviews = [
        {
          id: 61,
          user: alice,
          body: 'Please add a test for the empty list.',
          state: 'CHANGES_REQUESTED',
        },
      ];
      await poll();
      expect(await states()).toEqual([['review:61', 'needs_user']]);
      fake.pull.reviews.push({ id: 62, user: alice, body: '', state: 'COMMENTED' });
      await poll();
      expect(await states()).toEqual([['review:61', 'needs_user']]);
      fake.pull.reviews.push({ id: 63, user: alice, body: '', state: 'APPROVED' });
      await poll();
      expect(await states()).toEqual([['review:61', 'done']]);
    });
  },
);
