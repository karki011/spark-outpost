import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { outcomeReportSchema, outcomeResponseSchema } from '@spark-outpost/contracts';
import { refreshOutcome } from '../src/outcomes/record.ts';
import { sweepOutcomes } from '../src/outcomes/sweep.ts';
import { createTestApp, ORIGIN, LOCAL_HEADERS } from './app-support.ts';
import {
  seedAccept,
  seedCheck,
  seedConversation,
  seedIntake,
  seedTask,
  seedTurn,
} from './outcome-seed.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  await t.cleanup();
});

const noSample = { random: () => 0.99 };
const refresh = (runId: string, options = {}) =>
  refreshOutcome(t.db, t.workspaceId, runId, { ...noSample, ...options });
const put = (path: string, body: object) =>
  request(app).put(path).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const get = (path: string) => request(app).get(path).set(LOCAL_HEADERS);

describe('outcome lifecycle', () => {
  it('records a kept change, asks once, and keeps feedback changeable', async () => {
    const conversationId = await seedConversation(t.db, t.workspaceId);
    const taskId = await seedTask(t.db, conversationId);
    const runId = await seedTurn(t.db, conversationId, { taskId });
    await seedAccept(t.db, runId, 'keep');

    const first = await refresh(runId);
    expect(first).toMatchObject({ kind: 'change', prompt: 'mixed', verdict: 'good', score: 1 });
    expect(first!.signals).toEqual([
      expect.objectContaining({ kind: 'kept', source: 'user', polarity: 1 }),
    ]);

    const up = await put(`/api/runs/${runId}/feedback`, { rating: 'up' }).expect(200);
    expect(outcomeResponseSchema.parse(up.body).outcome?.feedback).toMatchObject({
      rating: 'up',
      reasons: [],
      comment: null,
    });
    const down = await put(`/api/runs/${runId}/feedback`, {
      rating: 'down',
      reasons: ['broke_something', 'broke_something'],
      comment: '  Broke the header  ',
    }).expect(200);
    const changed = outcomeResponseSchema.parse(down.body).outcome!;
    expect(changed.feedback).toMatchObject({
      rating: 'down',
      reasons: ['broke_something'],
      comment: 'Broke the header',
    });
    expect(changed.verdict).toBe('bad');
    expect(changed.prompt).toBe('mixed');

    const followUp = await seedTurn(t.db, conversationId, {
      taskId,
      request: "that's wrong, the header moved",
      createdAt: new Date(),
      intake: true,
    });
    await seedAccept(t.db, followUp, 'keep');
    const corrected = await refresh(runId);
    expect(corrected!.signals.map((signal) => `${signal.kind}:${signal.source}`)).toEqual([
      'kept:user',
      'correction:heuristic',
    ]);
    expect(corrected!.signals[1]!.detail).toMatchObject({ followUpRunId: followUp });
    expect((await refresh(followUp))!.prompt).toBeNull();

    const fetched = await get(`/api/runs/${runId}/outcome`).expect(200);
    expect(outcomeResponseSchema.parse(fetched.body).outcome?.feedback?.rating).toBe('down');
  });

  it('hides the prompt when the signals agree, unless the turn is sampled', async () => {
    const conversationId = await seedConversation(t.db, t.workspaceId);
    const agreeing = async () => {
      const taskId = await seedTask(t.db, conversationId);
      const runId = await seedTurn(t.db, conversationId, { taskId });
      await seedAccept(t.db, runId, 'keep');
      await seedCheck(t.db, taskId, runId, 'passed');
      return runId;
    };
    const hidden = await refresh(await agreeing());
    expect(hidden).toMatchObject({ prompt: null, verdict: 'good' });
    const sampled = await refresh(await agreeing(), { random: () => 0.05 });
    expect(sampled!.prompt).toBe('sampled');
  });

  it('asks under an answer, never for a failed run, and not before a run ends', async () => {
    const conversationId = await seedConversation(t.db, t.workspaceId);
    const answer = await seedTurn(t.db, conversationId, { depth: 'direct' });
    expect(await refresh(answer)).toMatchObject({ kind: 'answer', prompt: 'mixed' });
    const failed = await seedTurn(t.db, conversationId, { status: 'failed' });
    expect(await refresh(failed)).toMatchObject({ kind: 'other', prompt: null, verdict: 'bad' });
    const running = await seedTurn(t.db, conversationId, { status: 'running' });
    expect(await refresh(running)).toBeNull();
    await put(`/api/runs/${running}/feedback`, { rating: 'up' }).expect(409);
    await put(`/api/runs/${randomUUID()}/feedback`, { rating: 'up' }).expect(404);
    await put(`/api/runs/${answer}/feedback`, { rating: 'meh' }).expect(400);
  });

  it('records a revert and the reasons given', async () => {
    const conversationId = await seedConversation(t.db, t.workspaceId);
    const runId = await seedTurn(t.db, conversationId, { taskId: null });
    await seedAccept(t.db, runId, 'revert');
    expect(await refresh(runId)).toMatchObject({ kind: 'change', prompt: 'mixed', verdict: 'bad' });
    const saved = await put(`/api/runs/${runId}/feedback`, {
      rating: 'down',
      reasons: ['wrong_approach', 'too_much_change'],
    }).expect(200);
    expect(outcomeResponseSchema.parse(saved.body).outcome?.feedback?.reasons).toEqual([
      'wrong_approach',
      'too_much_change',
    ]);
  });

  it('settles a turn after a quiet day through the sweep', async () => {
    const conversationId = await seedConversation(t.db, t.workspaceId);
    const old = new Date(Date.now() - 26 * 60 * 60 * 1000);
    const runId = await seedTurn(t.db, conversationId, { depth: 'direct', createdAt: old });
    expect(await sweepOutcomes(t.db, t.workspaceId, noSample)).toBe(1);
    const outcome = await refresh(runId);
    expect(outcome!.signals.map((signal) => signal.kind)).toEqual(['quiet_24h']);
    expect(await sweepOutcomes(t.db, t.workspaceId, noSample)).toBe(0);
  });
});

describe('outcome analytics', () => {
  it('groups outcomes and compares Jev with the rules', async () => {
    const conversationId = await seedConversation(t.db, t.workspaceId);
    const same = await seedTurn(t.db, conversationId, {
      category: 'feature',
      request: 'Add a dark mode toggle to settings',
    });
    await seedIntake(t.db, same, { jev: { provider: 'claude' }, differences: [] });
    await seedAccept(t.db, same, 'keep');
    const differs = await seedTurn(t.db, conversationId, {
      category: 'docs',
      request: 'Document the cache settings in the README',
    });
    await seedIntake(t.db, differs, { jev: { provider: 'codex' }, differences: ['provider'] });
    await seedAccept(t.db, differs, 'revert');
    const noJev = await seedTurn(t.db, conversationId, {
      status: 'cancelled',
      request: 'Summarise the release notes for October',
    });
    for (const runId of [same, differs, noJev]) await refresh(runId);

    const byPick = outcomeReportSchema.parse(
      (await get('/api/analytics/outcomes?groupBy=jev_vs_rules').expect(200)).body,
    );
    expect(byPick.groups.map((group) => [group.key, group.good, group.bad])).toEqual([
      ['differs', 0, 1],
      ['no_jev', 0, 1],
      ['same', 1, 0],
    ]);
    const byCategory = outcomeReportSchema.parse(
      (await get('/api/analytics/outcomes?groupBy=category&days=7').expect(200)).body,
    );
    expect(byCategory.groups.find((group) => group.key === 'docs')).toMatchObject({
      turns: 1,
      reverted: 1,
    });
    await get('/api/analytics/outcomes?groupBy=vibes').expect(400);
  });
});
