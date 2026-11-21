import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkReviews } from '../src/github-inbox/review/runner.ts';
import { saveReviewSettings } from '../src/github-inbox/review/settings.ts';
import { getReview } from '../src/github-inbox/review/views.ts';
import { sparkAvailability } from '../src/spark-mcp/availability.ts';
import type { SparkScope, SparkToolDeps } from '../src/spark-mcp/deps.ts';
import { startSparkMcpHost, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import { sparkToolsFor } from '../src/spark-mcp/server.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { newSpark, useWorkflowsDir } from './crew-workflow-support.ts';
import { SHA, addPull, reviewWorld, type ReviewWorld } from './github-review-support.ts';
import { toolDeps } from './spark-mcp-support.ts';
import { eventually } from './support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

let world: ReviewWorld;
let dropWorkflows: () => Promise<void>;
let harness: Worker | null = null;
let host: SparkMcpHost | null = null;
const reviewGrants: string[][] = [];

async function recordingAvailability(deps: SparkToolDeps, scope: SparkScope) {
  const available = await sparkAvailability(deps, scope);
  if (scope.reviewRun) reviewGrants.push(sparkToolsFor(scope, available).map((tool) => tool.name));
  return available;
}

beforeEach(async () => {
  dropWorkflows = await useWorkflowsDir();
  world = await reviewWorld(null);
  await connectAgents(world.t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await host?.close();
  host = null;
  reviewGrants.length = 0;
  await world.close();
  await dropWorkflows();
});

describe('an auto-review run end to end', () => {
  it('runs the Spark on the pull request, keeps its reply and posts what it chose to', async () => {
    const pip = await newSpark(world.t, 'Pip', {
      provider: 'claude',
      agentMode: 'bypassPermissions',
    });
    await saveReviewSettings(world.t.db, world.t.workspaceId, world.deps.store, {
      reviewer: { kind: 'spark', id: pip.id },
      autoReview: true,
      mayPost: true,
      mayApprove: false,
    });
    addPull(world, 1, {
      body: 'Small fix. #spark spark_github_review_post {"action":"comment","body":"Reviewed."}',
    });
    const deps = toolDeps(world.t, {
      secrets: world.secrets,
      github: {
        runCommand: async () => ({ code: 1, stdout: '', stderr: 'gh missing' }),
        locateGh: async () => null,
        apiUrl: world.github.url,
      },
    });
    host = await startSparkMcpHost(deps, recordingAvailability);
    harness = startTurnWorker(world.t, {
      sparkTools: host,
      agentEnv: { FAKE_ACP_MCP_CAPABILITIES: JSON.stringify({ http: true, sse: false }) },
    });

    await checkReviews(world.deps);
    world.clock.now += 3 * 60_000;
    await checkReviews(world.deps);

    const { rows } = await world.t.db.query<{ id: string }>('SELECT id FROM github_reviews');
    expect(rows).toHaveLength(1);
    const done = await eventually(async () => {
      const review = await getReview(world.t.db, world.t.workspaceId, rows[0]!.id);
      return review && review.state !== 'queued' && review.state !== 'running' ? review : null;
    }, 60_000);

    expect(done).toMatchObject({ state: 'done', headSha: SHA, error: null });
    expect(done.body).toContain('spark spark_github_review_post=');
    expect(done.posted.map((post) => post.kind)).toEqual(['comment']);
    expect(world.github.github.pulls[0]!.reviews).toMatchObject([
      { state: 'COMMENTED', body: 'Reviewed.', commit_id: SHA },
    ]);
    const child = await world.t.db.query<{
      id: string;
      conversation_id: string;
      mode: string;
      prompt: string;
      agent_mode: string | null;
      review: string;
    }>(
      `SELECT r.id, r.conversation_id, r.mode, r.prompt, r.agent_mode, r.route->'spark'->>'review' AS review
       FROM runs r JOIN workflow_runs w ON r.parent_run_id = w.run_id
       WHERE w.kind = 'review'`,
    );
    expect(child.rows).toHaveLength(1);
    expect(child.rows[0]!.mode).toBe('chat');
    expect(child.rows[0]!.review).toBe('true');
    expect(child.rows[0]!.agent_mode).not.toBe('bypassPermissions');
    expect(child.rows[0]!.prompt).toContain('<pull-request-material>');
    expect(reviewGrants.length).toBeGreaterThan(0);
    for (const offered of reviewGrants) {
      expect(offered).toContain('spark_github_review_post');
      expect(offered).toContain('spark_docs');
      for (const tool of ['spark_artifact', 'spark_crew_edit', 'spark_rules_edit']) {
        expect(offered).not.toContain(tool);
      }
    }
    await saveReviewSettings(world.t.db, world.t.workspaceId, world.deps.store, {
      reviewer: { kind: 'spark', id: pip.id },
      autoReview: true,
      mayPost: false,
      mayApprove: false,
    });
    const scope: SparkScope = {
      workspaceId: world.t.workspaceId,
      conversationId: child.rows[0]!.conversation_id,
      runId: child.rows[0]!.id,
      reviewRun: true,
    };
    const withoutPosting = sparkToolsFor(scope, await sparkAvailability(deps, scope));
    expect(withoutPosting.map((tool) => tool.name)).not.toContain('spark_github_review_post');

    await checkReviews(world.deps);
    expect((await world.t.db.query('SELECT 1 FROM github_reviews')).rowCount).toBe(1);
  }, 120_000);
});
