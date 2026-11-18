import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REVIEW_RETRY_MS } from '../src/github-inbox/review/decide.ts';
import { enqueueReview } from '../src/github-inbox/review/queue.ts';
import { queueAutoReviews, startDueReviews } from '../src/github-inbox/review/runner.ts';
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

const PULL = 'acme/widgets#1';

let world: ReviewWorld;
let dropWorkflows: () => Promise<void>;
let sparkId: string;

beforeEach(async () => {
  dropWorkflows = await useWorkflowsDir();
  world = await reviewWorld();
  sparkId = (await newSpark(world.t, 'Pip')).id;
  await saveReviewSettings(world.t.db, world.t.workspaceId, world.deps.store, {
    reviewer: { kind: 'spark', id: sparkId },
    autoReview: true,
    mayPost: false,
    mayApprove: false,
  });
});

afterEach(async () => {
  await world.close();
  await dropWorkflows();
});

async function rows() {
  const { rows } = await world.t.db.query<{
    head_sha: string;
    state: string;
    source: string;
    material: string | null;
  }>('SELECT head_sha, state, source, material FROM github_reviews ORDER BY requested_at');
  return rows;
}

const catchUp = (ms = 1000) => {
  world.clock.now = Math.max(world.clock.now, Date.now()) + ms;
};

function queueAuto(headSha: string) {
  return enqueueReview(world.t.db, {
    workspaceId: world.t.workspaceId,
    pull: PULL,
    headSha,
    reviewer: { kind: 'spark', id: sparkId, name: 'Pip' },
    source: 'auto',
    dueAt: new Date(world.clock.now),
  });
}

function pushWhenFilesAreRead(pushes: number) {
  const pull = world.github.github.pulls[0]!;
  const inner = world.deps.github.fetch;
  let left = pushes;
  const wrapped: typeof fetch = async (input, init) => {
    const response = await inner(input, init);
    if (left > 0 && String(input).includes('/pulls/1/files')) {
      left -= 1;
      pull.sha = `${left}`.repeat(40);
      if (left === 0) pull.sha = NEW_SHA;
    }
    return response;
  };
  world.deps = { ...world.deps, github: { ...world.deps.github, fetch: wrapped } };
}

describe('auto-review retries', () => {
  it('tries a head again after a review failed before it started, and never after a stop', async () => {
    addPull(world, 1);
    addPull(world, 2);
    expect(await queueAutoReviews(world.deps)).toBe(2);
    await world.t.db.query(
      `UPDATE github_reviews SET state = 'failed', error = 'GitHub was down', finished_at = $1
       WHERE pull_id = $2`,
      [new Date(world.clock.now), PULL],
    );
    await world.t.db.query(
      `UPDATE github_reviews SET state = 'stopped', finished_at = $1 WHERE pull_id <> $2`,
      [new Date(world.clock.now), PULL],
    );
    expect(await queueAutoReviews(world.deps)).toBe(0);
    world.clock.now += REVIEW_RETRY_MS + 1000;
    expect(await queueAutoReviews(world.deps)).toBe(1);
    expect((await rows()).map((row) => row.state).sort()).toEqual(['failed', 'queued', 'stopped']);
  });

  it('leaves a head alone when its review failed after it started', async () => {
    addPull(world, 1);
    await queueAuto(SHA);
    catchUp();
    await startDueReviews(world.deps);
    await world.t.db.query(
      `UPDATE github_reviews SET state = 'failed', error = 'No reply', finished_at = $1`,
      [new Date(world.clock.now)],
    );
    world.clock.now += REVIEW_RETRY_MS + 1000;
    expect(await queueAutoReviews(world.deps)).toBe(0);
  });
});

describe('starting a queued review', () => {
  it('drops an automatic review of a pull request that became a draft', async () => {
    const pull = addPull(world, 1);
    await queueAuto(SHA);
    pull.draft = true;
    catchUp();
    await startDueReviews(world.deps);
    expect(await rows()).toEqual([]);
  });

  it('still reviews a draft the user asked for', async () => {
    addPull(world, 1, { draft: true });
    await send(world, 'post', '/api/github/reviews', { pull: PULL }).expect(201);
    catchUp();
    await startDueReviews(world.deps);
    expect(await rows()).toMatchObject([{ state: 'running', source: 'manual' }]);
  });

  it('drops an automatic review when the live head already has one', async () => {
    addPull(world, 1, { sha: NEW_SHA });
    await send(world, 'post', '/api/github/reviews', { pull: PULL }).expect(201);
    catchUp();
    await startDueReviews(world.deps);
    await world.t.db.query(`UPDATE github_reviews SET state = 'done', finished_at = now()`);
    await queueAuto(SHA);
    catchUp();
    await startDueReviews(world.deps);
    expect(await rows()).toMatchObject([{ state: 'done', head_sha: NEW_SHA, source: 'manual' }]);
  });

  it('reads the diff again when a push lands while it is read, and records that head', async () => {
    addPull(world, 1);
    await send(world, 'post', '/api/github/reviews', { pull: PULL }).expect(201);
    pushWhenFilesAreRead(1);
    catchUp();
    await startDueReviews(world.deps);
    const [review] = await rows();
    expect(review).toMatchObject({ state: 'running', head_sha: NEW_SHA });
    expect(review!.material).toContain(`Head commit: ${NEW_SHA}`);
    const reads = world.github.github.requests.filter((entry) =>
      entry.path.endsWith('/pulls/1/files'),
    );
    expect(reads).toHaveLength(2);
  });

  it('fails the review when the pull request keeps changing', async () => {
    addPull(world, 1);
    await send(world, 'post', '/api/github/reviews', { pull: PULL }).expect(201);
    pushWhenFilesAreRead(9);
    catchUp();
    await startDueReviews(world.deps);
    expect(await rows()).toMatchObject([{ state: 'failed', material: null }]);
  });
});
