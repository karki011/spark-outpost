import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditFileLineSchema, type AuditFileLine } from '@spark-outpost/contracts';
import { verifyRunLog } from '../src/persistence/audit-log.ts';
import { sweepProviderSessions } from '../src/persistence/provider-sessions.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { createTestApp, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { driveToEnd, gitRepo, openChat, removeRepo, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const TURNS = [
  'The divider shows the wrong day after midnight. Fix it. #build',
  'Also fix the footer typo. #build',
  'Where are we? What changed so far?',
];

let t: TestDb;
let root: string;
let store: string;
let worker: Worker;
let conversationId: string;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-export-'));
  await connectAgents(t);
  worker = startTurnWorker(t, { sessions: store });
  conversationId = await openChat(t, { root, level: 'hands-off' });
  for (const text of TURNS) {
    const runId = await sendMessage(t, conversationId, text, {
      permission: 'do',
      agentMode: 'default',
    });
    await driveToEnd(t, conversationId, runId);
  }
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

async function exported(): Promise<AuditFileLine[]> {
  const app = createTestApp(t, {
    diagnostics: { appVersion: '9.8.7', logDir: null, dataDir: null },
  });
  const response = await request(app)
    .get(`/api/conversations/${conversationId}/audit/export.jsonl`)
    .set(LOCAL_HEADERS)
    .buffer(true)
    .parse((res, done) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      res.on('end', () => done(null, text));
    });
  expect(response.status).toBe(200);
  return (response.body as string)
    .trimEnd()
    .split('\n')
    .map((line) => auditFileLineSchema.parse(JSON.parse(line)));
}

function ofType<T extends AuditFileLine['type']>(lines: readonly AuditFileLine[], type: T) {
  return lines.filter((line): line is Extract<AuditFileLine, { type: T }> => line.type === type);
}

describe('decision audit in the export', { timeout: 300_000 }, () => {
  it('answers what happened in each turn: one run, its session and end reason, and no Jev call', async () => {
    const lines = await exported();

    expect(ofType(lines, 'meta')).toMatchObject([
      { appVersion: '9.8.7', harness: 'simple', messageText: 'redacted', exportVersion: 2 },
    ]);
    const turns = ofType(lines, 'turn');
    expect(turns.map((turn) => turn.messageText)).toEqual(TURNS);
    expect(turns.map((turn) => turn.runs)).toEqual([1, 1, 1]);
    expect(turns.map((turn) => turn.sessions)).toEqual([
      { opened: 1, resumed: 0, replaced: 0, modelChanges: 0 },
      { opened: 0, resumed: 1, replaced: 0, modelChanges: 0 },
      { opened: 0, resumed: 1, replaced: 0, modelChanges: 0 },
    ]);
    expect(turns.every((turn) => turn.jevCalls === 0 && turn.status === 'succeeded')).toBe(true);
    expect(ofType(lines, 'jev')).toEqual([]);

    const sessions = ofType(lines, 'session');
    expect(sessions.map((session) => [session.event, session.reason, session.agentKey])).toEqual([
      ['open', 'first session', 'chat:claude'],
      ['resume', 'continued', 'chat:claude'],
      ['resume', 'continued', 'chat:claude'],
    ]);

    const ends = ofType(lines, 'run_end');
    expect(ends.map((end) => [end.role, end.endReason])).toEqual([
      [null, 'success'],
      [null, 'success'],
      [null, 'success'],
    ]);

    for (const run of ofType(lines, 'run')) {
      expect(await verifyRunLog(t.db, run.runId)).toMatchObject({ intact: true });
    }
  });

  it('lists the same decisions as CSV', async () => {
    const response = await request(createTestApp(t))
      .get(`/api/conversations/${conversationId}/audit/export.csv?view=decisions`)
      .set(LOCAL_HEADERS);
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('-decisions.csv');
    const [header, ...rows] = response.text.trimEnd().split('\r\n');
    expect(header).toContain('type,at,user_message_id,run_id,what,status,reason');
    const types = rows.map((row) => row.split(',')[0]);
    expect(types).toEqual(expect.arrayContaining(['meta', 'turn', 'run_end', 'session', 'card']));
    expect(types).not.toContain('jev');
    const cards = rows.filter((row) => row.startsWith('card'));
    expect(cards.map((row) => row.split(',')[4])).toEqual([
      'edit: Write notes.txt',
      'accept: Changes kept',
      'edit: Write notes.txt',
      'accept: Changes kept',
    ]);
  });

  it('records a close with its reason when a session is swept outside any run', async () => {
    await t.db.query(
      `UPDATE provider_sessions SET last_used_at = now() - interval '2 days' WHERE closed_at IS NULL`,
    );
    expect(await sweepProviderSessions(t.db, { idleMs: 60_000 })).toBeGreaterThan(0);
    const sessions = ofType(await exported(), 'session');
    expect(sessions.at(-1)).toMatchObject({ event: 'close', reason: 'idle', runId: null });
  });
});
