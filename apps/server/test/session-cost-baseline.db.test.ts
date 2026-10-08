import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversation } from '../src/persistence/conversations.ts';
import { evictBeyondLimit } from '../src/persistence/provider-sessions.ts';
import type { RunInput } from '../src/workflow/run-input.ts';
import { conversationSeatKey } from '../src/workflow/conversation-session.ts';
import { prepareTurnSession, type TurnEnd } from '../src/workflow/turn-session.ts';
import { chatTurnInput, createTestDb, SESSION_LIMITS, type TestDb } from './support.ts';

let t: TestDb;
let chat: string;

beforeEach(async () => {
  t = await createTestDb();
  chat = (await createConversation(t.db, t.workspaceId, randomUUID())).id;
});

afterEach(async () => {
  await t.cleanup();
});

const SESSION = 'claude-session';
const BEFORE_STOP = 1.111265;
const AFTER_STOP = 1.218969;

async function reply(content: string) {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES ($1, $2, 'assistant', $3, clock_timestamp())`,
    [id, chat, content],
  );
  return id;
}

const builder = (): RunInput => ({
  ...chatTurnInput(t, chat, null),
  parentRunId: randomUUID(),
  mode: 'do',
  role: 'builder',
  resumeKey: 'task-1:builder',
});

const reader = (): RunInput => ({
  ...chatTurnInput(t, chat, null),
  parentRunId: randomUUID(),
  mode: 'ask',
  role: 'scout',
  resumeKey: conversationSeatKey('task-1'),
});

interface Turn {
  reported: readonly number[];
  end: TurnEnd | null;
  sessionId?: string;
}

async function run(input: RunInput, turn: Turn): Promise<number[]> {
  const session = await prepareTurnSession(t.db, input, SESSION_LIMITS);
  if (!session) throw new Error('The run was not tracked.');
  const sessionId = turn.sessionId ?? SESSION;
  await session.started({
    kind: 'session',
    sessionId,
    cwd: '/work',
    additionalDirectories: [],
    continued: session.target.resume?.sessionId === sessionId,
    freshReason: session.target.freshReason,
  });
  const charged: number[] = [];
  for (const costUsd of turn.reported) {
    const counted = await session.usage({
      kind: 'usage',
      contextUsed: 10,
      contextSize: 100,
      costUsd,
    });
    charged.push(counted.costUsd ?? Number.NaN);
  }
  if (turn.end) await session.finished(turn.end);
  return charged;
}

const done = (text = 'Done.'): TurnEnd => ({ outcome: 'succeeded', messageId: null, text });
const stopped: TurnEnd = {
  outcome: 'cancelled',
  messageId: null,
  text: '',
  stopReason: 'cancelled',
};
const failed: TurnEnd = { outcome: 'failed', messageId: null, text: '' };

describe("a run's cost when the agent reports its session's cumulative cost", () => {
  beforeEach(async () => {
    expect(await run(builder(), { reported: [BEFORE_STOP], end: done() })).toEqual([BEFORE_STOP]);
  });

  it('charges the next run only its own part after a run stopped before any cost was reported', async () => {
    expect(await run(builder(), { reported: [], end: stopped })).toEqual([]);
    const [next] = await run(builder(), { reported: [AFTER_STOP], end: done() });
    expect(next).toBeCloseTo(AFTER_STOP - BEFORE_STOP, 6);
  });

  it('keeps what a stopped run was charged and charges the next run the rest', async () => {
    const [partial] = await run(builder(), { reported: [1.15], end: stopped });
    expect(partial).toBeCloseTo(1.15 - BEFORE_STOP, 6);
    const [next] = await run(builder(), { reported: [AFTER_STOP], end: done() });
    expect(next).toBeCloseTo(AFTER_STOP - 1.15, 6);
  });

  it('charges the run after a failed run only its own part', async () => {
    const [partial] = await run(builder(), { reported: [1.15], end: failed });
    expect(partial).toBeCloseTo(1.15 - BEFORE_STOP, 6);
    const [next] = await run(builder(), { reported: [AFTER_STOP], end: done() });
    expect(next).toBeCloseTo(AFTER_STOP - 1.15, 6);
  });

  it('keeps the baseline across a failed run and a run stopped before any cost was reported', async () => {
    await run(builder(), { reported: [1.15], end: failed });
    await run(builder(), { reported: [], end: stopped });
    const [next] = await run(builder(), { reported: [AFTER_STOP], end: done() });
    expect(next).toBeCloseTo(AFTER_STOP - 1.15, 6);
  });

  it('charges the run after a crashed run only its own part', async () => {
    await run(builder(), { reported: [1.15], end: null });
    const [next] = await run(builder(), { reported: [AFTER_STOP], end: done() });
    expect(next).toBeCloseTo(AFTER_STOP - 1.15, 6);
  });

  it('charges the run after one whose session row was closed while it ran only its own part', async () => {
    const session = await prepareTurnSession(t.db, builder(), SESSION_LIMITS);
    await session?.started({
      kind: 'session',
      sessionId: SESSION,
      cwd: '/work',
      additionalDirectories: [],
      continued: true,
      freshReason: null,
    });
    await evictBeyondLimit(t.db, 0);
    await session?.usage({ kind: 'usage', contextUsed: 10, contextSize: 100, costUsd: 1.15 });
    await session?.finished(done());
    const [next] = await run(builder(), { reported: [AFTER_STOP], end: done() });
    expect(next).toBeCloseTo(AFTER_STOP - 1.15, 6);
  });

  it('charges a reader and a Builder that share the session one after the other their own parts', async () => {
    const [answer] = await run(reader(), { reported: [1.14], end: done('It trims.') });
    expect(answer).toBeCloseTo(1.14 - BEFORE_STOP, 6);
    const [built] = await run(builder(), { reported: [1.16, AFTER_STOP], end: done() });
    expect(built).toBeCloseTo(1.16 - 1.14, 6);
  });

  it('charges a replaced session from zero', async () => {
    await reply('Earlier.');
    const charged = await run(builder(), { reported: [0.04], end: done(), sessionId: 'new' });
    expect(charged).toEqual([0.04]);
  });
});
