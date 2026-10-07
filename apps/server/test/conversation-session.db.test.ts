import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@spark-outpost/contracts';
import { FRESH_REASONS, handoffNote } from '../src/agents/acp/session-open.ts';
import { SESSION_HANDOFF_HEADING } from '../src/orchestration/handoff.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { sweepSessions } from '../src/workflow/turn-session.ts';
import { linkedConversation } from './approval-support.ts';
import {
  NORMAL,
  TRIVIAL,
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  type Harness,
  type JevScript,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, pinChatLevel, type TestDb } from './support.ts';

const QUESTION: Scenario = {
  id: 'status',
  text: 'Where are we? What changed so far?',
  mode: 'do',
  question: 0.97,
  destructive: 0.01,
  continuesTask: 0.9,
  intent: 'question',
  tier: 'small',
};
const FOLLOW_UP: Scenario = {
  ...TRIVIAL,
  text: 'Also fix the footer typo. #build',
  continuesTask: 0.95,
};

const LISTS_SESSIONS = {
  FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify({ resume: {}, close: {}, list: {} }),
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
    agentEnv: { ...LISTS_SESSIONS, FAKE_ACP_STICKY_CONFIG: '1' },
  });
  conversationId = (await linkedConversation(t, root)).conversationId;
  await pinChatLevel(t.db, conversationId, 'hands-off');
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

async function turn(scenario: Scenario, agentMode = 'acceptEdits', text = scenario.text) {
  script.scenario = scenario;
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: text },
    {
      provider: 'claude',
      model: 'sonnet',
      effort: 'medium',
      permission: 'do',
      agentMode,
      level: 'hands-off',
    },
  );
  harness.worker.wake();
  const { orchestration } = await driveToEnd(t, conversationId, sent.run.id, undefined, 90_000);
  expect(orchestration.status).toBe('succeeded');
  return sent.run.id;
}

async function events(runId: string): Promise<SessionEvent[]> {
  const { rows } = await t.db.query<{ body: SessionEvent }>(
    `SELECT e.body FROM provider_session_events e JOIN runs r ON r.id = e.run_id
     WHERE r.id = $1 OR r.parent_run_id = $1 ORDER BY e.at, e.id`,
    [runId],
  );
  return rows.map((row) => row.body);
}

async function requests(runId: string) {
  const { rows } = await t.db.query<{
    seq: number;
    method: string;
    payload: { params?: Record<string, unknown> };
  }>(
    `SELECT l.seq, l.method, l.payload FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
     WHERE (r.id = $1 OR r.parent_run_id = $1) AND l.direction = 'to_agent' AND l.kind = 'request'
     ORDER BY l.at, l.seq`,
    [runId],
  );
  return rows;
}

async function steps(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ name: string }>(
    `SELECT e.payload->>'stepName' AS name FROM run_events e JOIN runs r ON r.id = e.run_id
     WHERE (r.id = $1 OR r.parent_run_id = $1) AND e.type = 'STEP_STARTED' ORDER BY e.created_at, e.seq`,
    [runId],
  );
  return rows.map((row) => row.name);
}

function storedPrompts(): string[][] {
  return readdirSync(store)
    .filter((file) => file.endsWith('.json') && !file.endsWith('.config.json'))
    .map(
      (file) =>
        (JSON.parse(readFileSync(join(store, file), 'utf8')) as { prompts: string[] }).prompts,
    );
}

describe(
  'one conversation session per chat and provider (HARNESS=simple)',
  { timeout: 180_000 },
  () => {
    it('a status question after build turns resumes the session the Builder used', async () => {
      const first = await turn(NORMAL);
      const second = await turn(FOLLOW_UP);
      const question = await turn(QUESTION);

      expect((await events(first)).map((event) => [event.event, event.agentKey])).toEqual([
        ['open', 'chat:claude'],
      ]);
      expect((await events(second)).map((event) => event.event)).toEqual(['resume']);
      expect(await events(question)).toMatchObject([
        { event: 'resume', agentKey: 'chat:claude', harness: 'simple', kept: true },
      ]);
      expect((await requests(question)).map((request) => request.method)).not.toContain(
        'session/new',
      );
      expect(storedPrompts()).toHaveLength(1);
      expect(storedPrompts()[0]!.at(-1)).toContain(QUESTION.text);
      expect(storedPrompts()[0]!.at(-1)).not.toContain(NORMAL.text);
      expect((await assistantReplies(t, question)).join('\n')).toContain(
        'mode=read-only model=sonnet',
      );
    });

    it('a question after a Bypass build turn has its mode set back before the prompt and cannot write', async () => {
      await turn(NORMAL, 'bypassPermissions');
      const target = join(root, 'written-by-question.txt');
      const question = await turn(
        QUESTION,
        'bypassPermissions',
        `${QUESTION.text} #write #fswrite ${target}`,
      );

      const sent = await requests(question);
      const resumed = sent.findIndex((request) => request.method === 'session/resume');
      const modeSet = sent.findIndex(
        (request) =>
          request.method === 'session/set_config_option' &&
          request.payload.params?.configId === 'mode' &&
          request.payload.params?.value === 'read-only',
      );
      const prompted = sent.findIndex((request) => request.method === 'session/prompt');
      expect(resumed).toBeGreaterThanOrEqual(0);
      expect(modeSet).toBeGreaterThan(resumed);
      expect(prompted).toBeGreaterThan(modeSet);

      const { rows } = await t.db.query<{
        payload: { result: { configOptions: { id: string; currentValue: string }[] } };
      }>(
        `SELECT l.payload FROM run_protocol_log l
       WHERE l.run_id = $1 AND l.direction = 'from_agent' AND l.method = 'session/resume'`,
        [question],
      );
      const cameBackIn = rows[0]!.payload.result.configOptions.find(
        (option) => option.id === 'mode',
      );
      expect(cameBackIn?.currentValue).toBe('bypassPermissions');

      const run = await t.db.query<{ used_mode: string; mode: string }>(
        'SELECT used_mode, mode FROM runs WHERE id = $1',
        [question],
      );
      expect(run.rows[0]).toEqual({ used_mode: 'read-only', mode: 'ask' });
      expect(existsSync(target)).toBe(false);
      const reply = (await assistantReplies(t, question)).join('\n');
      expect(reply).toMatch(/Could not write notes\.txt|write .*=err:/);
      const allowed = await t.db.query(
        `SELECT 1 FROM approvals WHERE run_id = $1 AND status = 'allowed'`,
        [question],
      );
      expect(allowed.rowCount).toBe(0);
    });

    it('seeds a replacement with the handoff, says in one line that the session is gone and records why', async () => {
      const first = await turn(NORMAL);
      for (const file of readdirSync(store)) rmSync(join(store, file));
      const question = await turn(QUESTION);

      expect(await events(question)).toMatchObject([
        { event: 'replace', reason: FRESH_REASONS.gone, handoff: true, agentKey: 'chat:claude' },
      ]);
      const closes = await t.db.query<{ reason: string }>(
        `SELECT reason FROM provider_session_events WHERE conversation_id = $1 AND event = 'close'`,
        [conversationId],
      );
      expect(closes.rows).toEqual([{ reason: FRESH_REASONS.gone }]);
      expect(await steps(question)).toContain(handoffNote(FRESH_REASONS.gone));
      expect((await requests(question)).map((request) => request.method)).toEqual(
        expect.arrayContaining(['session/resume', 'session/list', 'session/new']),
      );
      const seeded = storedPrompts().flat().join('\n');
      expect(seeded).toContain(SESSION_HANDOFF_HEADING);
      expect(seeded).toContain(`## Goal\n${NORMAL.text}`);
      expect(seeded).toContain('## Files changed');
      expect(seeded).toContain('## Last three exchanges, verbatim');
      expect(seeded).toContain('## Chat totals\nEarlier turns: 1. Runs: 2.');
      expect(seeded).toContain(QUESTION.text);
      expect((await events(first)).map((event) => event.event)).toEqual(['open']);
    });

    it('says the agent still has the session when the resume fails for another reason', async () => {
      await turn(NORMAL);
      await harness.stop();
      harness = startOrchestrator(t, jevFetch(script), {
        sessions: store,
        harness: 'simple',
        agentEnv: { ...LISTS_SESSIONS, FAKE_ACP_RESUME_FAILS: '1' },
      });
      const question = await turn(QUESTION);
      expect(await events(question)).toMatchObject([
        { event: 'replace', reason: FRESH_REASONS.listed, handoff: true },
      ]);
      expect(await steps(question)).toContain(handoffNote(FRESH_REASONS.listed));
    });

    it('hands a second agent the handoff when the chat changes provider', async () => {
      await turn(NORMAL);
      script.scenario = QUESTION;
      const sent = await sendUserMessage(
        t.db,
        conversationId,
        { id: randomUUID(), content: QUESTION.text },
        {
          provider: 'codex',
          model: 'gpt-6-sol',
          effort: 'medium',
          permission: 'do',
          agentMode: 'ask-every-action',
          level: 'hands-off',
        },
      );
      harness.worker.wake();
      await driveToEnd(t, conversationId, sent.run.id, undefined, 90_000);
      expect(await events(sent.run.id)).toMatchObject([
        { event: 'open', reason: 'the agent changed', handoff: true, agentKey: 'chat:codex' },
      ]);
      expect(storedPrompts().flat().join('\n')).toContain(SESSION_HANDOFF_HEADING);
      const open = await t.db.query(
        `SELECT 1 FROM provider_sessions WHERE conversation_id = $1 AND closed_at IS NULL`,
        [conversationId],
      );
      expect(open.rowCount).toBe(2);
    });

    it('resumes after days idle, even when the sweeper closed the session', async () => {
      await turn(NORMAL);
      await t.db.query(
        `UPDATE provider_sessions SET last_used_at = now() - interval '3 days' WHERE conversation_id = $1`,
        [conversationId],
      );
      expect(await sweepSessions(t.db, { idleMs: 60_000, openLimit: 16 })).toBe(1);
      const second = await turn(FOLLOW_UP);
      expect((await events(second)).map((event) => event.event)).toEqual(['resume']);
      expect(storedPrompts()).toHaveLength(1);
    });
  },
);
