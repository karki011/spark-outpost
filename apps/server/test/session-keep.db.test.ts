import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { KEPT_FOR_SESSION } from '../src/orchestration/session-keep.ts';
import {
  SCENARIOS,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Harness,
  type JevScript,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const TRIVIAL = SCENARIOS[1] as Scenario;

let t: TestDb;
let root: string;
let store: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

async function secondTurn(conversationId: string, text: string) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: text },
    { provider: 'claude', model: 'sonnet', effort: 'medium', permission: 'do', level: 'hands-off' },
  );
  harness!.worker.wake();
  return driveToEnd(t, conversationId, sent.run.id).then((done) => ({
    ...done,
    runId: sent.run.id,
  }));
}

async function runRow(runId: string) {
  const { rows } = await t.db.query<{ model: string; effort: string }>(
    'SELECT model, effort FROM runs WHERE id = $1',
    [runId],
  );
  return rows[0]!;
}

async function sessionSteps(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ name: string }>(
    `SELECT payload->>'stepName' AS name FROM run_events
     WHERE run_id = $1 AND type = 'STEP_STARTED' ORDER BY seq`,
    [runId],
  );
  return rows.map((row) => row.name).filter((name) => /session/i.test(name));
}

describe('Auto routing on turn 2 of a chat with a resumable session', () => {
  it('keeps the session model when Jev is not sure enough to switch', async () => {
    const script: JevScript = { calls: [], scenario: { ...TRIVIAL, model: 'haiku', effort: 0 } };
    harness = startOrchestrator(t, jevFetch(script), { sessions: store });
    const first = await startScenario(t, root, script.scenario!, 'hands-off');
    await driveToEnd(t, first.conversationId, first.runId);
    expect(await runRow(first.runId)).toEqual({ model: 'haiku', effort: 'low' });

    script.scenario = { ...TRIVIAL, model: 'sonnet', effort: 2, modelConfidence: 0.45 };
    const second = await secondTurn(first.conversationId, 'Also fix the footer typo. #build');
    expect(second.orchestration.status).toBe('succeeded');
    expect(await runRow(second.runId)).toEqual({ model: 'haiku', effort: 'low' });
    expect(await sessionSteps(second.runId)).toContain('Continued session');
    const route = second.orchestration.decisions.find((decision) => decision.kind === 'route');
    expect(route?.summary).toContain(KEPT_FOR_SESSION);
    expect(route?.answer.rule).toBe(KEPT_FOR_SESSION);
    expect(route?.answer.session).toMatchObject({
      kept: true,
      session: { model: 'haiku', effort: 'low' },
    });
  }, 60_000);

  it('switches when Jev is confident about a stronger model and says the session is lost', async () => {
    const script: JevScript = { calls: [], scenario: { ...TRIVIAL, model: 'haiku', effort: 0 } };
    harness = startOrchestrator(t, jevFetch(script), { sessions: store });
    const first = await startScenario(t, root, script.scenario!, 'hands-off');
    await driveToEnd(t, first.conversationId, first.runId);

    script.scenario = { ...TRIVIAL, model: 'sonnet', effort: 2 };
    const second = await secondTurn(first.conversationId, 'Now refactor the header. #build');
    expect(await runRow(second.runId)).toEqual({ model: 'sonnet', effort: 'high' });
    expect(await sessionSteps(second.runId)).toContain('Fresh session (settings changed)');
    const route = second.orchestration.decisions.find((decision) => decision.kind === 'route');
    expect(route?.answer.session).toMatchObject({ kept: false });
  }, 60_000);
});
