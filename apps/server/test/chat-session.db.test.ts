import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@spark-outpost/contracts';
import { FRESH_REASONS, handoffNote } from '../src/agents/acp/session-open.ts';
import { SESSION_HANDOFF_HEADING } from '../src/workflow/session-brief.ts';
import { sweepSessions } from '../src/workflow/turn-session.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { createTestDb, type TestDb } from './support.ts';
import {
  auditOf,
  driveToEnd,
  gitRepo,
  openChat,
  removeRepo,
  sendMessage,
  type MessageOptions,
} from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const BUILD = 'The divider shows the wrong day after midnight. Fix it. #build';
const QUESTION = 'Where are we? What changed so far?';

const LISTS_SESSIONS = {
  FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify({ resume: {}, close: {}, list: {} }),
};

let t: TestDb;
let root: string;
let store: string;
let worker: Worker;
let conversationId: string;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-chat-session-'));
  await connectAgents(t);
  worker = startTurnWorker(t, { sessions: store, agentEnv: LISTS_SESSIONS });
  conversationId = await openChat(t, { root, level: 'hands-off' });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

async function turn(text: string, options: MessageOptions = {}) {
  const runId = await sendMessage(t, conversationId, text, { permission: 'do', ...options });
  const { run } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
  expect(run.status).toBe('succeeded');
  return runId;
}

async function events(runId: string): Promise<SessionEvent[]> {
  const { rows } = await t.db.query<{ body: SessionEvent }>(
    'SELECT body FROM provider_session_events WHERE run_id = $1 ORDER BY at, id',
    [runId],
  );
  return rows.map((row) => row.body);
}

async function requestsTo(runId: string): Promise<string[]> {
  const entries = await auditOf(t, runId);
  return entries
    .filter((entry) => entry.direction === 'to_agent' && entry.kind === 'request')
    .map((entry) => entry.method ?? '');
}

async function steps(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ name: string }>(
    `SELECT payload->>'stepName' AS name FROM run_events
     WHERE run_id = $1 AND type = 'STEP_STARTED' ORDER BY seq`,
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

describe('one session per chat and provider', { timeout: 180_000 }, () => {
  it('opens on the first turn and is resumed by every later turn, with the message as typed', async () => {
    const first = await turn(BUILD);
    const second = await turn(QUESTION);

    expect((await events(first)).map((event) => [event.event, event.agentKey])).toEqual([
      ['open', 'chat:claude'],
    ]);
    expect(await events(second)).toMatchObject([
      { event: 'resume', agentKey: 'chat:claude', kept: true },
    ]);
    expect(await requestsTo(second)).not.toContain('session/new');
    expect(storedPrompts()).toHaveLength(1);
    expect(storedPrompts()[0]!.at(-1)).toContain(QUESTION);
    expect(storedPrompts()[0]!.at(-1)).not.toContain(BUILD);
  });

  it('seeds a replacement with the handoff, says in one line that the session is gone and records why', async () => {
    await turn(BUILD);
    await worker.stop();
    worker = startTurnWorker(t, { sessions: store, agentEnv: LISTS_SESSIONS });
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
    expect(await requestsTo(question)).toEqual(
      expect.arrayContaining(['session/resume', 'session/list', 'session/new']),
    );
    const seeded = storedPrompts().flat().join('\n');
    expect(seeded).toContain(SESSION_HANDOFF_HEADING);
    expect(seeded).toContain(`## Goal\n${BUILD}`);
    expect(seeded).toContain('## Files changed');
    expect(seeded).toContain('## Last three exchanges, verbatim');
    expect(seeded).toContain(QUESTION);
  });

  it('hands a second agent the handoff when the chat changes provider', async () => {
    await turn(BUILD);
    const runId = await turn(QUESTION, { provider: 'codex', agentMode: 'ask-every-action' });

    expect(await events(runId)).toMatchObject([
      { event: 'open', reason: 'the agent changed', handoff: true, agentKey: 'chat:codex' },
    ]);
    expect(storedPrompts().flat().join('\n')).toContain(SESSION_HANDOFF_HEADING);
    const open = await t.db.query(
      'SELECT 1 FROM provider_sessions WHERE conversation_id = $1 AND closed_at IS NULL',
      [conversationId],
    );
    expect(open.rowCount).toBe(2);
  });

  it('resumes after days idle, even when the sweeper closed the session', async () => {
    await turn(BUILD);
    await t.db.query(
      `UPDATE provider_sessions SET last_used_at = now() - interval '3 days' WHERE conversation_id = $1`,
      [conversationId],
    );
    expect(await sweepSessions(t.db, { idleMs: 60_000 })).toBe(1);
    const second = await turn(`${BUILD} #again`);
    expect((await events(second)).map((event) => event.event)).toEqual(['resume']);
    expect(storedPrompts()).toHaveLength(1);
  });
});
