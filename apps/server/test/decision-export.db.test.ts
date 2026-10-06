import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { auditFileLineSchema, type AuditFileLine } from '@spark-outpost/contracts';
import { sweepProviderSessions } from '../src/persistence/provider-sessions.ts';
import { verifyRunLog } from '../src/persistence/audit-log.ts';
import { createTestApp, LOCAL_HEADERS } from './app-support.ts';
import { REPLAY_CASES } from './replay/replay-cases.ts';
import { runReplay, type ReplayResult } from './replay/replay-support.ts';

let replay: ReplayResult | null = null;

afterEach(async () => {
  await replay?.cleanup();
  replay = null;
});

const caseOf = (id: string) => REPLAY_CASES.find((candidate) => candidate.id === id)!;

async function exported(result: ReplayResult): Promise<AuditFileLine[]> {
  const app = createTestApp(result.db, {
    diagnostics: { appVersion: '9.8.7', logDir: null, dataDir: null },
  });
  const response = await request(app)
    .get(`/api/conversations/${result.conversationId}/audit/export.jsonl`)
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
  it('answers what happened in each turn: runs, sessions, Jev calls, end reasons and the app version', async () => {
    replay = await runReplay(caseOf('status'), 'current');
    const lines = await exported(replay);

    expect(ofType(lines, 'meta')).toMatchObject([
      { appVersion: '9.8.7', harness: 'current', messageText: 'redacted', exportVersion: 2 },
    ]);
    const turns = ofType(lines, 'turn');
    expect(turns.map((turn) => turn.messageText)).toEqual(
      caseOf('status').turns.map((turn) => turn.scenario.text),
    );
    expect(turns.map((turn) => turn.runs)).toEqual([1, 1, 1]);
    expect(turns.map((turn) => turn.sessions)).toEqual([
      { opened: 1, resumed: 0, replaced: 0, modelChanges: 0 },
      { opened: 0, resumed: 1, replaced: 0, modelChanges: 0 },
      { opened: 1, resumed: 0, replaced: 0, modelChanges: 0 },
    ]);
    expect(turns.every((turn) => turn.jevCalls > 0 && turn.status === 'succeeded')).toBe(true);

    const sessions = ofType(lines, 'session');
    expect(sessions.map((session) => [session.event, session.reason, session.agentKey])).toEqual([
      ['open', 'first session', expect.stringMatching(/^key:.+:builder$/)],
      ['resume', 'continued', expect.stringMatching(/^key:.+:builder$/)],
      ['open', 'first session', 'chat:ask'],
    ]);
    const opens = sessions.filter((session) => session.event === 'open');
    expect(opens.every((session) => (session.carriedTokens ?? 0) > 0)).toBe(true);

    const intake = ofType(lines, 'jev').filter((call) => call.purpose === 'intake');
    expect(intake).toHaveLength(3);
    expect(intake[0]).toMatchObject({ status: 'answered', model: 'jev-test', inputTokens: 1000 });
    expect(intake[0]!.questions.map((question) => question.id)).toContain('intent');
    expect(intake[0]!.stateChars).toBeGreaterThan(0);
    expect(intake[0]!.latencyMs).not.toBeNull();

    const ends = ofType(lines, 'run_end');
    expect(ends.filter((end) => end.role === 'builder').map((end) => end.endReason)).toEqual([
      'success',
      'success',
    ]);
    expect(ends.every((end) => end.cost.source === 'estimated')).toBe(true);

    for (const run of ofType(lines, 'run')) {
      expect(await verifyRunLog(replay.db.db, run.runId)).toMatchObject({ intact: true });
    }
  });

  it('lists the same decisions as CSV', async () => {
    replay = await runReplay(caseOf('plan'), 'current');
    const app = createTestApp(replay.db);
    const response = await request(app)
      .get(`/api/conversations/${replay.conversationId}/audit/export.csv?view=decisions`)
      .set(LOCAL_HEADERS);
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('-decisions.csv');
    const [header, ...rows] = response.text.trimEnd().split('\r\n');
    expect(header).toContain('type,at,user_message_id,run_id,what,status,reason');
    const types = rows.map((row) => row.split(',')[0]);
    expect(types).toEqual(
      expect.arrayContaining(['meta', 'turn', 'run_end', 'session', 'jev', 'card']),
    );
    expect(rows.find((row) => row.startsWith('card'))).toContain('Approve the plan?');
  });

  it('records a close with its reason when a session is swept outside any run', async () => {
    replay = await runReplay(caseOf('plan'), 'current');
    await replay.db.db.query(
      `UPDATE provider_sessions SET last_used_at = now() - interval '2 days' WHERE closed_at IS NULL`,
    );
    const closed = await sweepProviderSessions(replay.db.db, { idleMs: 60_000, openLimit: 16 });
    expect(closed).toBeGreaterThan(0);
    const sessions = ofType(await exported(replay), 'session');
    expect(sessions.at(-1)).toMatchObject({ event: 'close', reason: 'idle', runId: null });
  });
});
