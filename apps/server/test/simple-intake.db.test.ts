import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NEEDS_YOU_NOTE, UPGRADED_NOTE } from '../src/orchestration/simple-intake.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { linkedConversation } from './approval-support.ts';
import { PLAN_REPLY_TRIGGER } from './fake-acp-plans.ts';
import {
  NORMAL,
  RISKY,
  TRIVIAL,
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  setCheckCommands,
  startOrchestrator,
  type Harness,
  type JevScript,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, pinChatLevel, type TestDb } from './support.ts';

const BROKEN_BY_THE_CHANGE = `import { readFileSync } from 'node:fs';
if (readFileSync('notes.txt', 'utf8').includes('step')) {
  console.log(' FAIL  notes.test.ts > keeps the first line');
  process.exit(1);
}
`;
const VAGUE: Scenario = {
  ...NORMAL,
  id: 'vague',
  text: 'Make the reports better #build',
  vague: 0.95,
};
const PLAN_ONLY: Scenario = {
  id: 'plan',
  text: `Plan adding CSV export. Plan only for now: don't change any files. ${PLAN_REPLY_TRIGGER}`,
  mode: 'do',
  question: 0.69,
  planOnly: 0.9,
  destructive: 0.02,
  intent: 'feature',
};

let t: TestDb;
let root: string;
let store: string;
let harness: Harness;
let script: JevScript;
let conversationId: string;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t);
  script = { calls: [] };
  harness = startOrchestrator(t, jevFetch(script), {
    sessions: store,
    harness: 'simple',
    coordinator: 'in_order',
  });
  conversationId = (await linkedConversation(t, root)).conversationId;
  await t.db.query(`UPDATE conversations SET model_routing = 'auto' WHERE id = $1`, [
    conversationId,
  ]);
});

afterEach(async () => {
  await harness.stop();
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

async function turn(scenario: Scenario, level: 'hands-off' | 'full-auto' = 'full-auto') {
  await pinChatLevel(t.db, conversationId, level);
  script.scenario = scenario;
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: scenario.text },
    {
      provider: 'claude',
      model: 'sonnet',
      effort: 'medium',
      permission: 'do',
      agentMode: 'auto',
      level,
    },
  );
  harness.worker.wake();
  const done = await driveToEnd(t, conversationId, sent.run.id, () => null, 90_000);
  return { ...done, runId: sent.run.id };
}

async function children(runId: string) {
  const { rows } = await t.db.query<{ role: string; model: string; used_mode: string | null }>(
    `SELECT role, model, used_mode FROM runs WHERE parent_run_id = $1 OR (id = $1 AND role IS NOT NULL)
     ORDER BY created_at`,
    [runId],
  );
  return rows;
}

async function needs(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ need: string }>(
    `SELECT body->>'need' AS need FROM run_advice
     WHERE run_id = $1 AND purpose = 'route' AND body ? 'need' ORDER BY created_at`,
    [runId],
  );
  return rows.map((row) => row.need);
}

async function cards(runId: string) {
  const { rows } = await t.db.query<{ kind: string; decided_by: string | null }>(
    `SELECT a.kind, a.decided_by FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE (r.id = $1 OR r.parent_run_id = $1)
       AND (a.decided_by IS NULL OR a.decided_by IN ('user', 'stop', 'timeout'))`,
    [runId],
  );
  return rows;
}

describe('intake under HARNESS=simple', { timeout: 240_000 }, () => {
  it('a small change whose checks fail twice becomes a build, with no card', async () => {
    writeFileSync(join(root, 'check.mjs'), BROKEN_BY_THE_CHANGE);
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', [
      '-C',
      root,
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      'commit',
      '-qm',
      'check',
    ]);
    await setCheckCommands(t, root, ['node check.mjs']);

    const { runId, asked, orchestration } = await turn(TRIVIAL);

    expect(orchestration.status).toBe('succeeded');
    expect(asked).toEqual([]);
    expect(await cards(runId)).toEqual([]);
    expect(await needs(runId)).toEqual(['small_change', 'build']);
    const crew = await children(runId);
    expect(crew.map((member) => member.role)).toEqual(['builder', 'builder', 'builder']);
    expect((await assistantReplies(t, runId)).join('\n')).toContain(UPGRADED_NOTE);
  });

  it('asks its questions in the reply and ends the turn when the request is unclear', async () => {
    const { runId, asked, orchestration } = await turn(VAGUE);
    expect(orchestration.status).toBe('succeeded');
    expect(asked).toEqual([]);
    expect(await cards(runId)).toEqual([]);
    expect(await needs(runId)).toEqual(['needs_you']);
    expect((await children(runId)).map((member) => member.role)).toEqual(['scout']);
    const { rows } = await t.db.query<{ text: string }>(
      `SELECT l.payload->'params'->'prompt'->0->>'text' AS text FROM run_protocol_log l
       WHERE l.run_id = $1 AND l.method = 'session/prompt' AND l.kind = 'request'`,
      [runId],
    );
    expect(rows.map((row) => row.text).join('\n')).toContain(NEEDS_YOU_NOTE);
  });

  it('answers a plan-only request without putting the agent in plan mode or raising a plan card', async () => {
    const { runId, asked } = await turn(PLAN_ONLY);
    expect(asked).toEqual([]);
    expect(await cards(runId)).toEqual([]);
    expect(await needs(runId)).toEqual(['question']);
    const crew = await children(runId);
    expect(crew.map((member) => [member.role, member.used_mode])).toEqual([['scout', 'read-only']]);
  });

  it('builds a destructive request straight away at Full auto, with no plan card', async () => {
    const { runId, asked, orchestration } = await turn(RISKY);
    expect(orchestration.status).toBe('succeeded');
    expect(asked.map((approval) => approval.title)).not.toContain('Build this plan?');
    expect(await cards(runId)).toEqual([]);
    const roles = (await children(runId)).map((member) => member.role);
    expect(roles[0]).toBe('builder');
  });
});
