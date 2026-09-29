import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyticsHarnessSchema,
  analyticsOverviewSchema,
  analyticsSpendSchema,
  rollupReportSchema,
} from '@spark-outpost/contracts';
import { createTestApp, LOCAL_HEADERS } from './app-support.ts';
import { seedAnalyticsTurn, seedProjectChat, type AnalyticsTurn } from './analytics-seed.ts';
import { seedRealisticAnalytics } from './analytics-realistic.ts';
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

const get = (path: string) => request(app).get(path).set(LOCAL_HEADERS);
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

const builder = (model: string, costUsd: number, extra = {}) => ({
  role: 'builder' as const,
  provider: 'claude',
  model,
  name: 'Bolt',
  costUsd,
  ...extra,
});

async function seedScenario() {
  const projectChat = await seedProjectChat(t.db, t.workspaceId, 'spark-outpost');
  const loose = await seedProjectChat(t.db, t.workspaceId, null);
  const turn = (overrides: Partial<AnalyticsTurn>): AnalyticsTurn => ({
    conversationId: projectChat,
    createdAt: hoursAgo(2),
    category: 'bug_fix',
    ...overrides,
  });
  const differing = {
    rules: {
      provider: 'claude',
      depth: 'execute',
      model: 'claude-haiku-4-5',
      modelLabel: 'Haiku 4.5',
    },
    jev: {
      provider: 'claude',
      depth: 'execute',
      model: 'claude-sonnet-5',
      modelLabel: 'Sonnet 5',
      confidence: 0.93,
    },
  };
  for (let index = 0; index < 3; index++) {
    await seedAnalyticsTurn(
      t.db,
      turn({
        createdAt: hoursAgo(3),
        crew: [
          { role: 'architect', provider: 'claude', model: 'claude-sonnet-5', costUsd: 0.1 },
          builder('claude-sonnet-5', 0.2),
          builder('claude-sonnet-5', 0.2, {
            name: 'Rivet',
            session: 'continued',
            cachedRead: 1_000_000,
          }),
          {
            role: 'critic',
            provider: 'codex',
            model: 'gpt-6-sol',
            costUsd: 0.05,
            costSource: 'estimated',
          },
        ],
        depth: 'plan_execute_review',
        verdict: 'good',
        score: 0.9,
        signals: ['kept'],
        intake: { ...differing, wouldApply: 'jev', decision: 'act', actAt: 0.9, jevCostUsd: 0.01 },
        buildStyle: 'lean',
        reviews: [{ verdict: 'concerns', findings: 2, net: -10 }],
        checks: [{ round: 1, status: 'passed' }],
        approvals: [{ kind: 'execute', waitMs: 20_000 + index * 10_000 }],
      }),
    );
  }
  for (let index = 0; index < 3; index++) {
    await seedAnalyticsTurn(
      t.db,
      turn({
        crew: [builder('claude-haiku-4-5', 0.05, { session: 'fresh' })],
        verdict: 'bad',
        score: -0.8,
        signals: ['reverted'],
        intake: {
          ...differing,
          jev: { ...differing.jev, confidence: 0.6 },
          wouldApply: 'rules',
          decision: 'fallback',
          actAt: 0.9,
        },
        checks: [
          { round: 1, status: 'failed' },
          { round: 2, status: 'passed' },
        ],
        retries: 1,
      }),
    );
  }
  await seedAnalyticsTurn(t.db, {
    conversationId: loose,
    createdAt: hoursAgo(30),
    category: 'question',
    depth: 'direct',
    provider: 'codex',
    model: 'gpt-6-luna',
    costUsd: 0.02,
    verdict: 'unclear',
  });
  await seedAnalyticsTurn(t.db, {
    conversationId: loose,
    createdAt: hoursAgo(24 * 40),
    category: 'feature',
    costUsd: 5,
    verdict: 'good',
    score: 1,
  });
}

describe('analytics overview', () => {
  it('is honest about an empty workspace', async () => {
    const response = await get('/api/analytics/overview?range=7d&tz=UTC').expect(200);
    const overview = analyticsOverviewSchema.parse(response.body);
    expect(overview.window).toMatchObject({ range: '7d', days: 7 });
    expect(overview.days).toHaveLength(7);
    expect(overview.days.every((day) => day.turns === 0 && day.costUsd === 0)).toBe(true);
    expect(overview.totals).toMatchObject({
      turns: 0,
      costUsd: 0,
      keepRate: null,
      checkPassRate: null,
    });
    expect(overview.health).toMatchObject({ score: null, grade: 'not_enough_data' });
  });

  it('rolls turns, verdicts, cost and health into the window', async () => {
    await seedScenario();
    const response = await get('/api/analytics/overview?range=30d&tz=UTC').expect(200);
    const { totals, days, health } = analyticsOverviewSchema.parse(response.body);
    expect(totals).toMatchObject({
      turns: 7,
      good: 3,
      bad: 3,
      unclear: 1,
      kept: 3,
      reverted: 3,
      keepRate: 0.5,
      checkPassRate: 0.5,
      checksPassedFirst: 3,
      costSource: 'mixed',
    });
    expect(totals.costUsd).toBeCloseTo(3 * (0.1 + 0.2 + 0.2 + 0.05 + 0.01) + 3 * 0.05 + 0.02, 6);
    expect(days.reduce((sum, day) => sum + day.turns, 0)).toBe(7);
    expect(health.components.find((part) => part.id === 'outcomes')).toMatchObject({
      score: 50,
      n: 6,
    });
    expect(health.components.find((part) => part.id === 'loops')).toMatchObject({ score: 50 });
    expect(health.components.find((part) => part.id === 'waits')).toMatchObject({
      score: null,
      n: 3,
    });
    expect(health.score).toBe(52);
    expect(health.grade).toBe('needs_attention');
  });

  it('buckets days in the viewer time zone and supports custom ranges', async () => {
    const chat = await seedProjectChat(t.db, t.workspaceId, null);
    await seedAnalyticsTurn(t.db, {
      conversationId: chat,
      createdAt: new Date('2026-03-10T23:30:00Z'),
      costUsd: 1,
    });
    const tokyo = await get(
      '/api/analytics/overview?range=custom&from=2026-03-10&to=2026-03-11&tz=Asia/Tokyo',
    ).expect(200);
    const days = analyticsOverviewSchema.parse(tokyo.body).days;
    expect(days.map((day) => [day.date, day.turns])).toEqual([
      ['2026-03-10', 0],
      ['2026-03-11', 1],
    ]);
    const utc = await get('/api/analytics/overview?range=custom&from=2026-03-11&to=2026-03-11');
    expect(analyticsOverviewSchema.parse(utc.body).totals.turns).toBe(0);
  });

  it('rejects unknown ranges and oversized custom windows', async () => {
    await get('/api/analytics/overview?range=1y').expect(400);
    await get('/api/analytics/overview?range=custom&from=2026-03-11').expect(400);
    await get('/api/analytics/overview?range=custom&from=2024-01-01&to=2026-01-01').expect(400);
    await get('/api/analytics/overview?range=7d&tz=Not/A/Zone!').expect(400);
    await get('/api/analytics/rollups?groupBy=weekday').expect(400);
  });

  it('never counts another workspace', async () => {
    await seedScenario();
    await t.db.query(
      `INSERT INTO workspaces (id, slug, name) VALUES (gen_random_uuid(), 'other', 'Other')`,
    );
    const { rows } = await t.db.query<{ id: string }>(
      "SELECT id FROM workspaces WHERE slug = 'other'",
    );
    const otherChat = await seedProjectChat(t.db, rows[0]!.id, null);
    await seedAnalyticsTurn(t.db, {
      conversationId: otherChat,
      createdAt: hoursAgo(1),
      costUsd: 9,
    });
    const response = await get('/api/analytics/overview?range=7d');
    expect(analyticsOverviewSchema.parse(response.body).totals.turns).toBe(7);
  });
});

describe('analytics spend', () => {
  it('splits cost by project, provider and model and prices finished tasks', async () => {
    await seedScenario();
    const response = await get('/api/analytics/spend?range=30d&tz=UTC').expect(200);
    const spend = analyticsSpendSchema.parse(response.body);
    const sonnet = spend.leaves.find((leaf) => leaf.modelLabel === 'Sonnet 5');
    expect(sonnet).toMatchObject({ project: 'spark-outpost', provider: 'claude', runs: 9 });
    expect(sonnet!.costUsd).toBeCloseTo(1.5, 6);
    expect(
      spend.leaves.find((leaf) => leaf.provider === 'codex' && leaf.project === 'spark-outpost'),
    ).toMatchObject({ modelLabel: '6 Sol', estimatedUsd: 0.15, reportedUsd: 0 });
    expect(spend.jev).toEqual({ calls: 6, costUsd: 0.03 });
    expect(spend.estimatedUsd).toBeCloseTo(0.15 + 0.03, 6);
    const good = spend.perTask.find((row) => row.verdict === 'good')!;
    expect(good).toMatchObject({ tasks: 3 });
    expect(good.meanUsd).toBeCloseTo(0.56, 6);
    expect(spend.finishedTasks).toBe(7);
    expect(spend.costPerGoodUsd).toBeCloseTo((3 * 0.56 + 3 * 0.05 + 0.02) / 3, 6);
    expect(spend.resume).toMatchObject({ resumedRuns: 3, sessionRuns: 6, cachedTokens: 3_000_000 });
    expect(spend.resume.savedUsd).toBeCloseTo(3 * 1.8, 6);
  });

  it('counts cost with no recorded source as reported, once', async () => {
    const chat = await seedProjectChat(t.db, t.workspaceId, null);
    const runId = await seedAnalyticsTurn(t.db, {
      conversationId: chat,
      createdAt: new Date('2026-03-10T12:00:00Z'),
      costUsd: 2,
    });
    await t.db.query('UPDATE runs SET cost_source = NULL WHERE id = $1', [runId]);
    const response = await get(
      '/api/analytics/spend?range=custom&from=2026-03-10&to=2026-03-10&tz=UTC',
    ).expect(200);
    const spend = analyticsSpendSchema.parse(response.body);
    expect(spend.days).toEqual([{ date: '2026-03-10', reportedUsd: 2, estimatedUsd: 0 }]);
    expect(spend.leaves.reduce((sum, leaf) => sum + leaf.reportedUsd, 0)).toBe(2);
  });
});

describe('analytics harness', () => {
  it('builds the routing flow, gate points, disagreements and quality slices', async () => {
    await seedScenario();
    const response = await get('/api/analytics/harness?range=30d&tz=UTC').expect(200);
    const harness = analyticsHarnessSchema.parse(response.body);
    expect(harness.flow).toContainEqual({
      category: 'bug_fix',
      depth: 'plan_execute_review',
      crew: 'Architect + Builder ×2 + Critic',
      model: 'Sonnet 5',
      provider: 'claude',
      outcome: 'good',
      turns: 3,
    });
    expect(harness.flow).toContainEqual(
      expect.objectContaining({
        crew: 'Solo',
        depth: 'direct',
        outcome: 'unclear',
        model: '6 Luna',
      }),
    );
    expect(harness.confidence).toHaveLength(6);
    expect(harness.confidence[0]).toMatchObject({ confidence: 0.93, decision: 'act', actAt: 0.9 });
    expect(harness.disagreements).toEqual([
      expect.objectContaining({
        field: 'model',
        rulePick: 'Haiku 4.5',
        jevPick: 'Sonnet 5',
        turns: 6,
        winner: 'jev',
      }),
    ]);
    expect(harness.agreement.find((row) => row.key === 'differs')).toMatchObject({ turns: 6 });
    expect(harness.agreement.find((row) => row.key === 'no_jev')).toMatchObject({ turns: 1 });
    expect(harness.lean.map((row) => [row.style, row.turns, row.netLines])).toEqual([
      ['off', 3, 0],
      ['lean', 3, -30],
    ]);
    expect(harness.critic).toMatchObject({ reviews: 3, concerns: 3, findings: 6 });
    expect(harness.critic.reviewed).toMatchObject({ turns: 3, good: 3 });
    expect(harness.critic.unreviewed).toMatchObject({ turns: 3, bad: 3 });
    expect(harness.checks).toEqual({
      turns: 6,
      firstPassed: 3,
      finalPassed: 6,
      fixLoops: 3,
      rounds: 9,
    });
    expect(harness.loops).toEqual({ turns: 6, withRetries: 3, retries: 3, fixLoops: 3 });
    expect(harness.approvals).toMatchObject({ count: 3, medianMs: 30_000 });
  });

  it('rolls up by model and by Jev decision', async () => {
    await seedScenario();
    const byModel = rollupReportSchema.parse(
      (await get('/api/analytics/rollups?groupBy=model&range=30d')).body,
    );
    expect(byModel.rows[0]).toMatchObject({ key: 'Sonnet 5', turns: 3, good: 3, kept: 3 });
    const byDecision = rollupReportSchema.parse(
      (await get('/api/analytics/rollups?groupBy=jev_decision&range=30d')).body,
    );
    expect(Object.fromEntries(byDecision.rows.map((row) => [row.key, row.turns]))).toEqual({
      jev: 3,
      rules: 3,
      no_jev: 1,
    });
  });

  it('answers quickly over three months of realistic history', async () => {
    const seeded = await seedRealisticAnalytics(t.db, t.workspaceId, { days: 90 });
    expect(seeded).toBeGreaterThan(200);
    const started = performance.now();
    const [overview, spend, harness] = await Promise.all([
      get('/api/analytics/overview?range=90d').expect(200),
      get('/api/analytics/spend?range=90d').expect(200),
      get('/api/analytics/harness?range=90d').expect(200),
    ]);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(analyticsOverviewSchema.parse(overview.body).health.score).not.toBeNull();
    expect(analyticsSpendSchema.parse(spend.body).leaves.length).toBeGreaterThan(5);
    expect(analyticsHarnessSchema.parse(harness.body).flow.length).toBeGreaterThan(10);
  }, 60_000);
});
