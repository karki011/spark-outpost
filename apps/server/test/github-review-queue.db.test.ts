import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  githubReviewListSchema,
  githubReviewSchema,
  githubReviewSettingsSchema,
} from '@spark-outpost/contracts';
import { REVIEW_DEBOUNCE_MS } from '../src/github-inbox/review/decide.ts';
import {
  claimDueReviews,
  reclaimStrandedReviews,
  type ClaimedReview,
} from '../src/github-inbox/review/queue.ts';
import {
  STRANDED_REVIEW_MS,
  queueAutoReviews,
  startDueReviews,
} from '../src/github-inbox/review/runner.ts';
import { saveReviewSettings } from '../src/github-inbox/review/settings.ts';
import { newSpark, useWorkflowsDir } from './crew-workflow-support.ts';
import {
  NEW_SHA,
  SHA,
  addPull,
  reviewWorld,
  send,
  type ReviewWorld,
} from './github-review-support.ts';

let world: ReviewWorld;
let dropWorkflows: () => Promise<void>;
let sparkId: string;

beforeEach(async () => {
  dropWorkflows = await useWorkflowsDir();
  world = await reviewWorld();
  sparkId = (await newSpark(world.t, 'Pip')).id;
});

afterEach(async () => {
  await world.close();
  await dropWorkflows();
});

const reviewer = () => ({ kind: 'spark' as const, id: sparkId });

async function settings(extra: Record<string, unknown> = {}) {
  await saveReviewSettings(world.t.db, world.t.workspaceId, world.deps.store, {
    reviewer: reviewer(),
    autoReview: false,
    mayPost: false,
    mayApprove: false,
    ...extra,
  });
}

async function rows() {
  const { rows } = await world.t.db.query<{
    id: string;
    pull_id: string;
    head_sha: string;
    state: string;
    source: string;
    due_at: Date;
  }>(
    'SELECT id, pull_id, head_sha, state, source, due_at FROM github_reviews ORDER BY requested_at',
  );
  return rows;
}

const advance = (ms: number) => {
  world.clock.now += ms;
};

const catchUp = () => {
  world.clock.now = Math.max(world.clock.now, Date.now()) + 1000;
};

describe('review settings', () => {
  it('start empty and name the picked reviewer', async () => {
    const empty = await send(world, 'get', '/api/github/review-settings').expect(200);
    expect(githubReviewSettingsSchema.parse(empty.body)).toEqual({
      reviewer: null,
      reviewerName: null,
      autoReview: false,
      mayPost: false,
      mayApprove: false,
    });
    const saved = await send(world, 'put', '/api/github/review-settings', {
      reviewer: reviewer(),
      autoReview: true,
      mayPost: true,
      mayApprove: true,
    }).expect(200);
    expect(saved.body).toMatchObject({ reviewerName: 'Pip', autoReview: true, mayApprove: true });
  });

  it('refuse unknown reviewers and switches that need another one', async () => {
    const put = (body: object) => send(world, 'put', '/api/github/review-settings', body);
    const off = { autoReview: false, mayPost: false, mayApprove: false };
    await put({ ...off, reviewer: { kind: 'spark', id: crypto.randomUUID() } }).expect(400);
    await put({ ...off, reviewer: { kind: 'workflow', id: 'missing-flow' } }).expect(400);
    await put({ ...off, reviewer: { kind: 'workflow', id: '../../etc' } }).expect(400);
    await put({ ...off, reviewer: null, autoReview: true }).expect(400);
    await put({ ...off, reviewer: reviewer(), mayApprove: true }).expect(400);
    await put({ ...off, reviewer: reviewer(), mayPost: 'yes' }).expect(400);
  });
});

describe('asking for a review', () => {
  it('needs a reviewer and a pull request in a linked project', async () => {
    addPull(world, 1);
    await send(world, 'post', '/api/github/reviews', { pull: 'acme/widgets#1' }).expect(400);
    await settings();
    await send(world, 'post', '/api/github/reviews', { pull: 'other/repo#1' }).expect(400);
    await send(world, 'post', '/api/github/reviews', { pull: 'not a pull' }).expect(400);
    await send(world, 'get', '/api/github/reviews?pull=nope').expect(400);
  });

  it('collapses duplicate requests into one queued review, even with auto-review off', async () => {
    addPull(world, 1);
    await settings();
    const first = await send(world, 'post', '/api/github/reviews', { pull: 'acme/widgets#1' });
    const again = await send(world, 'post', '/api/github/reviews', { pull: 'acme/widgets#1' });
    expect(githubReviewSchema.parse(first.body)).toMatchObject({
      pull: 'acme/widgets#1',
      headSha: SHA,
      reviewer: { kind: 'spark', id: sparkId, name: 'Pip' },
    });
    expect(again.body.id).toBe(first.body.id);
    const listed = await send(world, 'get', '/api/github/reviews?pull=acme/widgets%231');
    expect(githubReviewListSchema.parse(listed.body).reviews.map((r) => r.id)).toEqual([
      first.body.id,
    ]);
  });
});

describe('auto-review', () => {
  it('queues requested, ready pull requests by others once per head, debounced', async () => {
    await settings({ autoReview: true });
    addPull(world, 1);
    addPull(world, 2, { draft: true });
    addPull(world, 3, { openedBy: 'octo-token', requestedReviewers: [] });
    addPull(world, 4, { requestedReviewers: ['someone-else'] });

    expect(await queueAutoReviews(world.deps)).toBe(1);
    const [queued] = await rows();
    expect(queued).toMatchObject({ pull_id: 'acme/widgets#1', state: 'queued', source: 'auto' });
    expect(queued!.due_at.getTime()).toBe(world.clock.now + REVIEW_DEBOUNCE_MS);
    expect(
      await claimDueReviews(world.t.db, world.t.workspaceId, new Date(world.clock.now)),
    ).toEqual([]);

    advance(3 * 60_000);
    expect(await queueAutoReviews(world.deps)).toBe(0);
    world.github.github.pulls[0]!.sha = NEW_SHA;
    advance(3 * 60_000);
    expect(await queueAutoReviews(world.deps)).toBe(1);
    const burst = await rows();
    expect(burst).toHaveLength(1);
    expect(burst[0]).toMatchObject({ id: queued!.id, head_sha: NEW_SHA });
    expect(burst[0]!.due_at.getTime()).toBe(world.clock.now + REVIEW_DEBOUNCE_MS);
  });

  it('does nothing while it is off', async () => {
    await settings();
    addPull(world, 1);
    expect(await queueAutoReviews(world.deps)).toBe(0);
    expect(await rows()).toEqual([]);
  });

  it('marks the inbox row with the latest review and whether it is stale', async () => {
    await settings({ autoReview: true });
    addPull(world, 1);
    addPull(world, 5);
    await queueAutoReviews(world.deps);
    world.github.github.pulls[0]!.sha = NEW_SHA;
    const inbox = await send(world, 'get', '/api/github/inbox?refresh=1').expect(200);
    const byNumber = Object.fromEntries(
      (inbox.body.items as { number: number; review: unknown }[]).map((item) => [
        item.number,
        item.review,
      ]),
    );
    expect(byNumber[1]).toEqual({ state: 'queued', headSha: SHA, stale: true, posted: null });
    expect(byNumber[5]).toEqual({ state: 'queued', headSha: SHA, stale: false, posted: null });
  });
});

describe('claiming queued reviews', () => {
  it('runs one review per pull request at a time and queues the next head behind it', async () => {
    await settings();
    addPull(world, 1);
    await send(world, 'post', '/api/github/reviews', { pull: 'acme/widgets#1' }).expect(201);
    catchUp();
    const now = new Date(world.clock.now);
    const [first] = await claimDueReviews(world.t.db, world.t.workspaceId, now);
    expect(first).toMatchObject({ pull: 'acme/widgets#1', source: 'manual' });
    expect(await claimDueReviews(world.t.db, world.t.workspaceId, now)).toEqual([]);

    world.github.github.pulls[0]!.sha = NEW_SHA;
    const next = await send(world, 'post', '/api/github/reviews', { pull: 'acme/widgets#1' });
    expect(next.body.id).not.toBe(first!.id);
    expect(await claimDueReviews(world.t.db, world.t.workspaceId, now)).toEqual([]);
    expect((await rows()).map((row) => [row.state, row.head_sha])).toEqual([
      ['running', SHA],
      ['queued', NEW_SHA],
    ]);
  });

  it('starts a claim stranded by a restart exactly once', async () => {
    await settings();
    addPull(world, 1);
    await send(world, 'post', '/api/github/reviews', { pull: 'acme/widgets#1' }).expect(201);
    catchUp();
    const claimedAt = new Date(world.clock.now);
    const [claim] = await claimDueReviews(world.t.db, world.t.workspaceId, claimedAt);

    const soon = new Date(claimedAt.getTime() + 1000);
    expect(await reclaimStrandedReviews(world.t.db, world.t.workspaceId, soon, 60_000)).toEqual([]);
    advance(STRANDED_REVIEW_MS + 5000);
    const stranded = await reclaimStrandedReviews(
      world.t.db,
      world.t.workspaceId,
      new Date(world.clock.now),
      STRANDED_REVIEW_MS,
    );
    expect(stranded.map((entry: ClaimedReview) => entry.id)).toEqual([claim!.id]);

    advance(STRANDED_REVIEW_MS + 5000);
    await startDueReviews(world.deps);
    await startDueReviews(world.deps);
    const runs = await world.t.db.query<{ kind: string }>(
      `SELECT c.kind FROM workflow_runs w JOIN conversations c ON c.id = w.conversation_id
       WHERE w.kind = 'review'`,
    );
    expect(runs.rows).toEqual([{ kind: 'crew' }]);
    expect((await rows())[0]).toMatchObject({ state: 'running' });
  });
});

describe('stopping a review', () => {
  it('stops a queued review at once and refuses an unknown one', async () => {
    await settings();
    addPull(world, 1);
    const queued = await send(world, 'post', '/api/github/reviews', { pull: 'acme/widgets#1' });
    const stopped = await send(world, 'post', `/api/github/reviews/${queued.body.id}/stop`);
    expect(stopped.status).toBe(200);
    expect(stopped.body).toMatchObject({ state: 'stopped' });
    await send(world, 'post', `/api/github/reviews/${crypto.randomUUID()}/stop`).expect(404);
    await send(world, 'post', '/api/github/reviews/nope/stop').expect(400);
  });

  it('stops a started review whose turn has not run yet', async () => {
    await settings();
    addPull(world, 1);
    const queued = await send(world, 'post', '/api/github/reviews', { pull: 'acme/widgets#1' });
    catchUp();
    await startDueReviews(world.deps);
    const stopped = await send(world, 'post', `/api/github/reviews/${queued.body.id}/stop`);
    expect(stopped.body).toMatchObject({ state: 'stopped', body: null });
    const runs = await world.t.db.query<{ status: string }>(
      `SELECT r.status FROM workflow_runs w JOIN runs r ON r.id = w.run_id WHERE w.kind = 'review'`,
    );
    expect(runs.rows).toEqual([{ status: 'cancelled' }]);
  });
});
