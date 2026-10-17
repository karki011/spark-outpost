import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanUsageList } from '@spark-outpost/contracts';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { recordAccount } from '../src/model-access/store.ts';
import { disconnectProvider } from '../src/persistence/setup.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { planUsage, recordPlanReport } from '../src/usage/plan-limits.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { FAKE_ACP_LAUNCH as launch } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { connectCliProvider, createTestDb, eventually, type TestDb } from './support.ts';

const HOUR = 60 * 60 * 1000;
const MAX = { kind: 'account' as const, label: 'Claude Max', plan: 'max' };
const AUTH_STATUS = {
  authStatus: { kind: 'account', label: 'Claude Max', account: { plan: 'max' } },
};

let t: TestDb;
let worker: Worker | null = null;
let folder: string;

beforeEach(async () => {
  t = await createTestDb();
  folder = mkdtempSync(join(tmpdir(), 'spark-plan-limits-'));
  await connectCliProvider(t, 'claude');
  await recordAccount(t.db, t.workspaceId, 'claude', MAX);
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  rmSync(folder, { recursive: true, force: true });
  await t.cleanup();
});

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

function reading(window: 'five_hour' | 'seven_day', used: number, resetsAt: Date, limited = false) {
  return { window, used, resetsAt, limited };
}

async function shown(now = new Date()) {
  return planUsage(t.db, t.workspaceId, now);
}

describe('stored plan readings', { timeout: 30_000 }, () => {
  it('keeps the newest reading per window when two chats write out of order', async () => {
    const reset = new Date(Date.now() + 3 * HOUR);
    const later = new Date();
    const earlier = new Date(later.getTime() - 60_000);
    await recordPlanReport(
      t.db,
      t.workspaceId,
      'claude',
      {
        windows: [reading('five_hour', 0.4, reset)],
        extraUsage: null,
      },
      later,
    );
    await recordPlanReport(
      t.db,
      t.workspaceId,
      'claude',
      {
        windows: [reading('five_hour', 0.2, reset), reading('seven_day', 0.3, reset)],
        extraUsage: null,
      },
      earlier,
    );
    const [plan] = await shown();
    expect(plan?.windows.map((window) => [window.window, window.usedPercent])).toEqual([
      ['five_hour', 40],
      ['seven_day', 30],
    ]);
  });

  it('hides a window whose reset has passed', async () => {
    const reset = new Date(Date.now() + HOUR);
    await recordPlanReport(t.db, t.workspaceId, 'claude', {
      windows: [reading('five_hour', 0.9, reset)],
      extraUsage: null,
    });
    expect(await shown(new Date(reset.getTime() + 1))).toEqual([]);
  });

  it('shows nothing once the sign-in is a different account, an API key or disconnected', async () => {
    const report = {
      windows: [reading('seven_day', 0.5, new Date(Date.now() + 24 * HOUR))],
      extraUsage: {
        status: 'rejected' as const,
        inUse: false,
        disabledReason: null,
        resetsAt: null,
      },
    };
    await recordPlanReport(t.db, t.workspaceId, 'claude', report);
    expect(await shown()).toHaveLength(1);
    await recordAccount(t.db, t.workspaceId, 'claude', { ...MAX, label: 'Claude Pro' });
    expect(await shown()).toEqual([]);
    await recordAccount(t.db, t.workspaceId, 'claude', MAX);
    expect(await shown()).toHaveLength(1);
    await t.db.query(
      `UPDATE provider_model_access SET account_kind = 'api_key' WHERE workspace_id = $1`,
      [t.workspaceId],
    );
    expect(await shown()).toEqual([]);
    await t.db.query(
      `UPDATE provider_model_access SET account_kind = 'account' WHERE workspace_id = $1`,
      [t.workspaceId],
    );
    await disconnectProvider(t.db, t.workspaceId, 'claude');
    expect(await shown()).toEqual([]);
  });

  it('records nothing for Z.ai or an API-key sign-in', async () => {
    await connectCliProvider(t, 'zai');
    const report = {
      windows: [reading('five_hour', 0.5, new Date(Date.now() + HOUR))],
      extraUsage: null,
    };
    await recordPlanReport(t.db, t.workspaceId, 'zai', report);
    await t.db.query(
      `UPDATE provider_model_access SET account_kind = 'api_key' WHERE workspace_id = $1`,
      [t.workspaceId],
    );
    await recordPlanReport(t.db, t.workspaceId, 'claude', report);
    const { rows } = await t.db.query('SELECT 1 FROM provider_plan_limits');
    expect(rows).toEqual([]);
  });
});

function writeFixture(meta: Record<string, unknown>): string {
  const file = join(folder, `${randomUUID()}.json`);
  const update = {
    sessionUpdate: 'usage_update',
    used: 1_000,
    size: 1_000_000,
    _meta: { '_claude/rateLimit': meta },
  };
  writeFileSync(file, JSON.stringify({ sessionId: 'redacted', update }));
  return file;
}

function startClaude(fixture: string) {
  const provider = createAcpProvider({
    definition: { ...agentDefinitions.claude, ...FAKE_AGENT_MODES },
    launch,
    cancelGraceMs: 2_000,
    env: {
      ...childEnvironment(process.env),
      FAKE_ACP_RATE_LIMIT: fixture,
      FAKE_ACP_AUTH_STATUS: JSON.stringify(AUTH_STATUS),
    },
  });
  worker = startWorker({
    db: t.db,
    providers: new Map([['claude', provider]]),
    leaseSeconds: 30,
    concurrency: 2,
    pollMs: 20,
    cancelPollMs: 20,
  });
}

async function send(content: string) {
  const conversationId = randomUUID();
  await createConversation(t.db, t.workspaceId, conversationId);
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider: 'claude', model: null, effort: null },
    t.workspaceId,
  );
  return eventually(async () => {
    const current = await getRun(t.db, sent.run.id);
    return current?.finishedAt ? current : null;
  });
}

async function listed(): Promise<PlanUsageList> {
  const response = await request(createTestApp(t))
    .get('/api/usage/plan-limits')
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .expect(200);
  return response.body as PlanUsageList;
}

describe('a Claude turn that reports its plan', { timeout: 60_000 }, () => {
  it('serves the reading and leaves the turn as it was', async () => {
    const fiveHour = new Date(Date.now() + 2 * HOUR);
    const week = new Date(Date.now() + 72 * HOUR);
    startClaude(
      writeFixture({
        status: 'allowed',
        overageStatus: 'rejected',
        overageDisabledReason: 'out_of_credits',
        isUsingOverage: false,
        unifiedWindows: {
          five_hour: { utilization: 0.42, resetsAt: seconds(fiveHour) },
          seven_day: { utilization: 0.18, resetsAt: seconds(week) },
        },
      }),
    );
    const run = await send('#ratelimit');
    expect(run.status).toBe('succeeded');
    const { plans } = await listed();
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      provider: 'claude',
      windows: [
        { window: 'five_hour', usedPercent: 42, limited: false },
        { window: 'seven_day', usedPercent: 18, limited: false },
      ],
      extraUsage: { status: 'rejected', inUse: false, disabledReason: 'out_of_credits' },
    });
  });

  it('names the reset time when the turn fails on the limit', async () => {
    const reset = new Date(Date.now() + 2 * HOUR);
    startClaude(
      writeFixture({
        status: 'rejected',
        rateLimitType: 'five_hour',
        resetsAt: seconds(reset),
        unifiedWindows: { five_hour: { utilization: 1, resetsAt: seconds(reset) } },
      }),
    );
    const run = await send('#ratelimit #usagelimit');
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(
      /^Claude has reached this account's 5-hour limit\. It resets (at|on) /,
    );
  });

  it('keeps the plain limit message when no window is used up', async () => {
    const reset = new Date(Date.now() + 2 * HOUR);
    startClaude(
      writeFixture({
        status: 'allowed',
        unifiedWindows: { five_hour: { utilization: 0.3, resetsAt: seconds(reset) } },
      }),
    );
    const run = await send('#ratelimit #usagelimit');
    expect(run.status).toBe('failed');
    expect(run.error).not.toMatch(/resets/);
  });
});
