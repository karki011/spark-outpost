import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncCalendars } from '../src/calendar/service.ts';
import { setConnected } from '../src/calendar/store.ts';
import { MEETING_REFUSALS } from '../src/spark-mcp/actions/ask-spark-meetings.ts';
import { meetingsOffer } from '../src/spark-mcp/tools/calendar/offered.ts';
import { assistantRun, assistantScope, assistantSetup, setActs } from './ask-spark-support.ts';
import { fakeHost, helperEvent, MINUTE, type FakeHost } from './calendar-host-support.ts';
import {
  confirmCard,
  pendingCard,
  recordedHooks,
  startSparkTools,
  toolDeps,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const ZOOM = { noteLinks: ['https://acme.zoom.us/j/1'] };
const LATEST_START = 31 * MINUTE;

let t: TestDb;
let host: FakeHost;
let recorded: RecordedHooks;
let tools: SparkToolsHarness | null = null;
let assistant: string;
let shift = 0;

function shiftPastMidnight(now: number): number {
  const dayStart = new Date(now + LATEST_START);
  dayStart.setHours(0, 0, 0, 0);
  return dayStart.getTime() > now - MINUTE ? dayStart.getTime() + MINUTE - now : 0;
}

function meeting(title: string, startIn: number, extra: Parameters<typeof helperEvent>[3] = {}) {
  return helperEvent(title, 'work-1', startIn + shift / MINUTE, extra);
}

beforeEach(async () => {
  shift = shiftPastMidnight(Date.now());
  t = await createTestDb();
  assistant = await assistantSetup(t);
  host = fakeHost();
  host.authorization = 'fullAccess';
  recorded = recordedHooks();
});

afterEach(async () => {
  recorded.stop();
  await tools?.close();
  tools = null;
  await t.cleanup();
});

async function calendarWith(events: ReturnType<typeof helperEvent>[]) {
  host.events = events;
  await setConnected(t.db, t.workspaceId, true);
  await syncCalendars({ db: t.db, workspaceId: t.workspaceId, host });
}

async function open(question = 'Handle my next meeting') {
  const runId = await assistantRun(t, assistant, question);
  tools = await startSparkTools(t, assistantScope(assistant, runId, recorded), {
    calendar: { host, google: null },
    now: () => new Date(Date.now() + shift),
  });
  return tools;
}

async function requests() {
  const { rows } = await t.db.query<{ kind: string; target: string }>(
    'SELECT kind, target FROM island_requests ORDER BY created_at',
  );
  return rows;
}

async function dismissMarks() {
  const { rows } = await t.db.query<{ uid: string }>(
    `SELECT uid FROM calendar_marks WHERE kind = 'dismiss'`,
  );
  return rows.map((row) => row.uid);
}

const keyOf = (event: ReturnType<typeof helperEvent>) =>
  `${event.uid}@${new Date(event.start).toISOString()}`;

describe('Ask Spark meeting actions', () => {
  it('in Manual asks first, then snoozes the showing alert through the island', async () => {
    const standup = meeting('Standup', -0.5, { ...ZOOM, uid: 'evt-1' });
    await calendarWith([standup]);
    const harness = await open('Snooze my next meeting');
    const result = await harness.call('spark_meeting', { action: 'snooze' });
    expect(result.json()).toMatchObject({ outcome: 'waiting_for_user' });
    const card = await pendingCard(t);
    expect(card.title).toBe('Snooze the alert for your next meeting by 1 minute');
    expect(JSON.stringify(card.payload)).not.toContain('Standup');
    expect(await requests()).toEqual([]);
    const done = await confirmCard(t);
    expect(done.payload.sparkResult?.message).toBe(
      'Spark Island snoozes the meeting alert for 1 minute.',
    );
    expect(await requests()).toEqual([{ kind: 'snooze_meeting', target: keyOf(standup) }]);
  });

  it('in Act dismisses with the saved mark and joins through the island at once', async () => {
    await setActs(t, 'act');
    const review = meeting('Review', 5, { ...ZOOM, uid: 'evt-2' });
    await calendarWith([review]);
    const harness = await open();
    const dismissed = await harness.call('spark_meeting', { action: 'dismiss' });
    expect(dismissed.json()).toMatchObject({ outcome: 'done' });
    expect(await dismissMarks()).toEqual([review.uid]);
    const joined = await harness.call('spark_meeting', { action: 'join' });
    expect(joined.json()).toMatchObject({ outcome: 'done' });
    expect(await requests()).toEqual([{ kind: 'join_meeting', target: keyOf(review) }]);
    const audit = JSON.stringify(recorded.audited);
    expect(audit).toContain('Ask Spark');
    expect(audit).not.toContain('Review');
  });

  it.each([
    ['snooze', 'act'],
    ['dismiss', 'manual'],
    ['join', 'manual'],
  ] as const)('does %s in %s with the meeting whose alert is showing', async (verb, acts) => {
    await setActs(t, acts);
    const call = meeting('Call', -0.5, { ...ZOOM, uid: 'evt-3' });
    await calendarWith([call]);
    const harness = await open(`${verb} my next meeting`);
    const result = await harness.call('spark_meeting', { action: verb });
    const stored = async () => [...(await requests()), ...(await dismissMarks())];
    if (acts === 'manual') {
      expect(result.json()).toMatchObject({ outcome: 'waiting_for_user' });
      expect(await stored()).toEqual([]);
      expect((await confirmCard(t)).payload.sparkResult?.state).toBe('done');
    } else {
      expect(result.json()).toMatchObject({ outcome: 'done' });
    }
    const expected =
      verb === 'dismiss' ? ['evt-3'] : [{ kind: `${verb}_meeting`, target: keyOf(call) }];
    expect(await stored()).toEqual(expected);
  });

  it('asks which meeting when two overlap, and takes the one the user named', async () => {
    await setActs(t, 'act');
    const design = meeting('Design review', 2, ZOOM);
    const sales = meeting('Sales sync', 3, ZOOM);
    await calendarWith([design, sales]);
    const harness = await open('Join my meeting');
    const asked = await harness.call('spark_meeting', { action: 'join' });
    expect(asked.isError).toBe(true);
    expect(asked.text).toBe(MEETING_REFUSALS.clash);
    expect(await requests()).toEqual([]);
    const named = await harness.call('spark_meeting', { action: 'join', meeting: 'sales' });
    expect(named.json()).toMatchObject({ outcome: 'done' });
    expect(await requests()).toEqual([{ kind: 'join_meeting', target: keyOf(sales) }]);
  });

  it('refuses a join before the window or without an allowed link, and a snooze with no alert', async () => {
    await setActs(t, 'act');
    await calendarWith([
      meeting('Later', 30, ZOOM),
      meeting('Phone', 2, { noteLinks: ['https://evil.example/j/1'] }),
    ]);
    const harness = await open();
    const join = await harness.call('spark_meeting', { action: 'join' });
    expect(join.text).toBe(MEETING_REFUSALS.join_meeting);
    const snooze = await harness.call('spark_meeting', { action: 'snooze', meeting: 'later' });
    expect(snooze.text).toBe(MEETING_REFUSALS.snooze_meeting);
    expect(await requests()).toEqual([]);
  });

  it('fails a Manual card whose meeting ended before Do it', async () => {
    const soon = meeting('Soon', 0.5, ZOOM);
    await calendarWith([soon]);
    const harness = await open();
    await harness.call('spark_meeting', { action: 'join' });
    await pendingCard(t);
    host.events = [];
    await syncCalendars({ db: t.db, workspaceId: t.workspaceId, host });
    const done = await confirmCard(t);
    expect(done.payload.sparkResult?.state).toBe('failed');
    expect(await requests()).toEqual([]);
  });

  it('is offered only to Ask Spark on the Mac with a calendar connected', async () => {
    const deps = toolDeps(t, { calendar: { host, google: null } });
    const runId = await assistantRun(t, assistant, 'Snooze it');
    const scope = { workspaceId: t.workspaceId, conversationId: assistant, runId };
    expect(await meetingsOffer(deps, { ...scope, assistant: true })).toBe(false);
    await calendarWith([]);
    expect(await meetingsOffer(deps, { ...scope, assistant: true })).toBe(true);
    expect(await meetingsOffer(deps, scope)).toBe(false);
    expect(await meetingsOffer(toolDeps(t), { ...scope, assistant: true })).toBe(false);
    await t.db.query('UPDATE runs SET remote_device_id = $2 WHERE id = $1', [runId, randomUUID()]);
    expect(await meetingsOffer(deps, { ...scope, assistant: true })).toBe(false);
  });
});
