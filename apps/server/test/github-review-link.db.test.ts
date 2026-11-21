import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  finishWorkflowRun,
  insertWorkflowRun,
  listWorkflowRuns,
  pullNamedIn,
  settleStep,
} from '../src/crew-flows/run-records.ts';
import {
  STOP_IN_CHAT,
  linkRunsStartedElsewhere,
  queueAutoReviews,
} from '../src/github-inbox/review/runner.ts';
import { saveReviewSettings } from '../src/github-inbox/review/settings.ts';
import { settleReviewOfWorkflowRun } from '../src/github-inbox/review/settle.ts';
import { newSpark, step, useWorkflowsDir } from './crew-workflow-support.ts';
import { addPull, reviewWorld, send, type ReviewWorld } from './github-review-support.ts';
import { startChat } from './support.ts';

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

async function runInChat(message: string) {
  const { conversationId, runId } = await startChat(world.t, `@gauntlet ${message}`);
  const id = randomUUID();
  await insertWorkflowRun(world.t.db, {
    id,
    workspaceId: world.t.workspaceId,
    workflow: { id: 'gauntlet', name: 'The Gauntlet', steps: [step('look', sparkId)] },
    kind: 'run',
    source: 'mention',
    conversationId,
    runId,
    message,
    continues: false,
  });
  return { id, conversationId };
}

const reviewsOf = async (pull: string) =>
  (await send(world, 'get', `/api/github/reviews?pull=${encodeURIComponent(pull)}`).expect(200))
    .body.reviews;

describe('a workflow run started outside the GitHub page', () => {
  it('reads the pull request a message names', () => {
    expect(pullNamedIn('Review https://github.com/acme/widgets/pull/12 please')).toBe(
      'acme/widgets#12',
    );
    expect(pullNamedIn('Review the docs')).toBeNull();
  });

  it('becomes that pull request’s review, says where it started and settles with the run', async () => {
    addPull(world, 1);
    const run = await runInChat('Review https://github.com/acme/widgets/pull/1');

    expect(await linkRunsStartedElsewhere(world.deps)).toBe(1);
    expect(await linkRunsStartedElsewhere(world.deps)).toBe(0);
    expect(await reviewsOf('acme/widgets#1')).toEqual([
      expect.objectContaining({
        state: 'running',
        reviewer: { kind: 'workflow', id: 'gauntlet', name: 'The Gauntlet' },
        startedFrom: 'mention',
        chatId: run.conversationId,
      }),
    ]);

    await settleStep(world.t.db, run.id, 'look', 'succeeded', 'Looks fine.');
    await finishWorkflowRun(world.t.db, run.id, 'succeeded', null);
    await settleReviewOfWorkflowRun(world.t.db, run.id);
    const [review] = await reviewsOf('acme/widgets#1');
    expect(review).toMatchObject({ state: 'done', body: 'Looks fine.' });

    const listed = await listWorkflowRuns(world.t.db, world.t.workspaceId, 'gauntlet');
    expect(listed).toEqual([
      expect.objectContaining({ id: run.id, source: 'mention', pull: 'acme/widgets#1' }),
    ]);
  });

  it('keeps auto-review from reviewing the same commit again', async () => {
    await saveReviewSettings(world.t.db, world.t.workspaceId, world.deps.store, {
      reviewer: { kind: 'spark', id: sparkId },
      autoReview: true,
      mayPost: false,
      mayApprove: false,
    });
    addPull(world, 1);
    await runInChat('Review https://github.com/acme/widgets/pull/1');
    await linkRunsStartedElsewhere(world.deps);
    expect(await queueAutoReviews(world.deps)).toBe(0);
  });

  it('is stopped in its chat, not from the GitHub page', async () => {
    addPull(world, 1);
    await runInChat('Review https://github.com/acme/widgets/pull/1');
    await linkRunsStartedElsewhere(world.deps);
    const [review] = await reviewsOf('acme/widgets#1');
    const refused = await send(world, 'post', `/api/github/reviews/${review.id}/stop`).expect(400);
    expect(refused.body.error ?? refused.body.message).toContain(STOP_IN_CHAT);
  });

  it('is left alone when its pull request is not on the GitHub page or it names none', async () => {
    addPull(world, 1);
    await runInChat('Review https://github.com/acme/widgets/pull/99');
    await runInChat('Tidy the docs');
    expect(await linkRunsStartedElsewhere(world.deps)).toBe(0);
    expect(await reviewsOf('acme/widgets#1')).toEqual([]);
  });
});
