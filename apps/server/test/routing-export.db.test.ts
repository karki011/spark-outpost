import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditSummarySchema } from '@spark-outpost/contracts';
import { createTestApp, localClient } from './app-support.ts';
import {
  NORMAL,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function finishedChat(routing: 'auto' | 'pinned'): Promise<string> {
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: NORMAL }));
  const started = await startScenario(t, root, NORMAL, 'hands-off', routing);
  await driveToEnd(t, started.conversationId, started.runId);
  return started.conversationId;
}

function csvRows(csv: string): Record<string, string>[] {
  const [header, ...lines] = csv.trimEnd().split('\r\n');
  const names = header!.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(names.map((name, index) => [name, cells[index] ?? '']));
  });
}

describe('routing in the audit export', () => {
  it('shows the rule and tier of an Auto pick in the summary, the CSV and the JSONL', async () => {
    const conversationId = await finishedChat('auto');
    const client = localClient(createTestApp(t));
    const base = `/api/conversations/${conversationId}/audit`;

    const summary = auditSummarySchema.parse(
      (await client.get(`${base}/summary`).expect(200)).body,
    );
    const builder = summary.runs.find((run) => run.role === 'Builder');
    expect(builder?.model).toBe('sonnet');
    expect(builder?.route?.routedBy).not.toBe('pinned');
    expect(builder?.route?.tier).toBe('mid');
    expect(builder?.route?.rule).toBeTruthy();

    const csv = csvRows((await client.get(`${base}/export.csv`).expect(200)).text);
    const row = csv.find((line) => line.run_id === builder!.runId);
    expect(row).toMatchObject({ routed_by: builder!.route!.routedBy, model_tier: 'mid' });
    expect(row?.route_rule).not.toBe('');

    const jsonl = (await client.get(`${base}/export.jsonl`).expect(200)).text;
    const runLine = jsonl
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; runId?: string; route?: unknown })
      .find((line) => line.type === 'run' && line.runId === builder!.runId);
    expect(runLine?.route).toEqual(builder!.route);
  }, 90_000);

  it('marks a pinned chat as pinned', async () => {
    const conversationId = await finishedChat('pinned');
    const client = localClient(createTestApp(t));
    const summary = auditSummarySchema.parse(
      (await client.get(`/api/conversations/${conversationId}/audit/summary`).expect(200)).body,
    );
    const builder = summary.runs.find((run) => run.role === 'Builder');
    expect(builder?.route).toEqual({ routedBy: 'pinned', rule: 'pinned', tier: 'mid' });
  }, 90_000);
});
