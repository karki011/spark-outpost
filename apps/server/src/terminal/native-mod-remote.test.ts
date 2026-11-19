import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FACT_AT,
  fromEngine,
  startSparkMod,
  type SparkModHarness,
} from '../../test/spark-mod-engine.ts';

let mod: SparkModHarness;

beforeEach(async () => {
  mod = await startSparkMod();
});

afterEach(async () => {
  await mod.cleanup();
});

const edit = { tool: 'Edit', tool_use_id: 'toolu_9', file_path: '/a.ts', old_string: 'a' };
const editInput = { file_path: '/a.ts', old_string: 'a' };

async function startTurn(prompt = 'prompt-1', turnId = 'turn-1') {
  await mod.hook('classic.UserPromptSubmit')(mod.engine, { prompt_id: prompt }, fromEngine());
  await mod.hook('turn.start')(mod.engine, { turnId }, fromEngine());
  mod.running(turnId);
}

async function completeTurn(turnId = 'turn-1') {
  await mod.hook('turn.complete')(
    mod.engine,
    { turnId, durationMs: 10, isAborted: false },
    fromEngine(),
  );
  mod.running(null);
}

async function poll(body: object) {
  mod.inbox({ messages: [], notices: [], status: null, ...body });
  await mod.tick();
}

function telemetry() {
  return mod.requests
    .filter((request) => request.url.endsWith('/mod/telemetry'))
    .flatMap((request) => (JSON.parse(String(request.init.body)) as { items: object[] }).items);
}

describe('Stop through the Spark mod', () => {
  it('tells Spark it can stop a turn and aborts the running turn of the prompt Spark names', async () => {
    await startTurn();
    await poll({ abort: 'prompt-1' });
    expect(JSON.parse(String(mod.requests[0]!.init.body))).toEqual({ abort: true });
    expect(mod.aborted).toEqual(['turn-1']);
  });

  it('aborts nothing once that turn has completed', async () => {
    await startTurn();
    await completeTurn();
    await poll({ abort: 'prompt-1' });
    expect(mod.aborted).toEqual([]);
  });

  it('leaves a newer prompt’s turn alone when Spark asked to stop an older one', async () => {
    await startTurn('prompt-1', 'turn-1');
    await completeTurn('turn-1');
    await startTurn('prompt-2', 'turn-2');
    await poll({ abort: 'prompt-1' });
    expect(mod.aborted).toEqual([]);
  });

  it('leaves a turn alone when its prompt came with no id and Spark names the earlier prompt', async () => {
    await startTurn('prompt-1', 'turn-1');
    await completeTurn('turn-1');
    await mod.hook('classic.UserPromptSubmit')(mod.engine, {}, fromEngine());
    await mod.hook('turn.start')(mod.engine, { turnId: 'turn-2' }, fromEngine());
    mod.running('turn-2');
    await poll({ abort: 'prompt-1' });
    expect(mod.aborted).toEqual([]);
  });

  it('leaves a turn that started with no prompt alone when Spark names the earlier prompt', async () => {
    await startTurn('prompt-1', 'turn-1');
    await completeTurn('turn-1');
    await mod.hook('turn.start')(mod.engine, { turnId: 'turn-2' }, fromEngine());
    mod.running('turn-2');
    await poll({ abort: 'prompt-1' });
    expect(mod.aborted).toEqual([]);
  });

  it('keeps polling when Claude refuses the abort', async () => {
    await startTurn();
    mod.running('another-turn');
    await poll({ abort: 'prompt-1' });
    await poll({ messages: ['next'] });
    expect(mod.submitted).toEqual([{ text: 'next', asUser: true }]);
  });
});

describe('the line under Claude’s permission dialog', () => {
  async function ask() {
    let finish: (value: unknown) => void = () => undefined;
    const running = mod.hook('tool.call')(
      mod.engine,
      edit,
      fromEngine(() => new Promise((done) => (finish = done))),
    );
    await mod.hook('classic.PermissionRequest')(
      mod.engine,
      { tool_name: 'Edit', tool_input: editInput },
      fromEngine(),
    );
    finish({ text: 'ok' });
    await running;
  }

  it('names Spark under the dialog of the call Claude asks about, with recording off', async () => {
    await poll({ askNotice: 'Also answerable from Spark on your phone' });
    await ask();
    expect(mod.notices).toEqual([
      { id: 'toolu_9', text: 'Also answerable from Spark on your phone' },
    ]);
  });

  it('shows nothing when Spark has no way to answer', async () => {
    await poll({ askNotice: null });
    await ask();
    expect(mod.notices).toEqual([]);
  });

  it('shows nothing for a call that has already finished', async () => {
    await poll({ askNotice: 'Also answerable from Spark on your phone' });
    await mod.hook('tool.call')(
      mod.engine,
      edit,
      fromEngine(async () => ({ text: 'ok' })),
    );
    await mod.hook('classic.PermissionRequest')(
      mod.engine,
      { tool_name: 'Edit', tool_input: editInput },
      fromEngine(),
    );
    expect(mod.notices).toEqual([]);
  });
});

describe('Spark’s pinned status line', () => {
  it('counts messages from Spark waiting for Claude and clears once Claude takes them', async () => {
    let release: (value: unknown) => void = () => undefined;
    mod.holdSubmits(new Promise((done) => (release = done)));
    await poll({ messages: ['one', 'two'] });
    expect(mod.statuses).toEqual(['Spark · 2 messages from Spark queued']);
    release(null);
    await new Promise((done) => setTimeout(done, 0));
    expect(mod.statuses.at(-1)).toBeUndefined();
    expect(mod.statuses).toContain('Spark · 1 message from Spark queued');
  });

  it('shows when a scheduled wakeup will start the next turn, and clears when it does', async () => {
    const wakes = new Date(FACT_AT + 3_600_000);
    const schedule = `${wakes.getMinutes()} ${wakes.getHours()} ${wakes.getDate()} ${wakes.getMonth() + 1} *`;
    await mod.hook('classic.Stop')(
      mod.engine,
      { session_crons: [{ id: 'c', schedule, recurring: false, prompt: 'check' }] },
      fromEngine(),
    );
    expect(mod.statuses).toHaveLength(1);
    expect(mod.statuses[0]).toMatch(/^Spark · sleeping until /);
    await startTurn();
    expect(mod.statuses.at(-1)).toBeUndefined();
  });

  it('ignores recurring crons and writes nothing while there is nothing to say', async () => {
    await mod.hook('classic.Stop')(
      mod.engine,
      { session_crons: [{ id: 'c', schedule: '0 9 * * 1-5', recurring: true, prompt: 'x' }] },
      fromEngine(),
    );
    await poll({});
    expect(mod.statuses).toEqual([]);
  });
});

describe('measurements and the end of the session', () => {
  const measure = (usd: number, percentUsed: number) => ({
    context: { tokens: 50_000, window: 200_000, percent: 25 },
    rateLimits: [
      { kind: 'five_hour', percentUsed, resetsAt: '2026-11-18T20:00:00Z' },
      { kind: 'seven_day', percentUsed: 7 },
    ],
    cost: { usd },
    changed: ['cost'],
  });

  it('sends only the latest measurement, with its rate-limit windows', async () => {
    await mod.hook('session.measure')(mod.engine, measure(0.5, 20), fromEngine());
    await mod.hook('session.measure')(mod.engine, measure(0.75, 23.5), fromEngine());
    mod.inbox({ messages: [], notices: [], status: null });
    mod.answer(204);
    await mod.tick();
    expect(telemetry()).toEqual([
      {
        kind: 'measure',
        at: FACT_AT,
        context: { tokens: 50_000, window: 200_000, percent: 25 },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-11-18T20:00:00Z' },
          { kind: 'seven_day', percentUsed: 7, resetsAt: null },
        ],
        costUsd: 0.75,
      },
    ]);
  });

  it('delivers why the session ended and its resume id before Claude exits', async () => {
    mod.answer(204);
    await mod.hook('session.end')(
      mod.engine,
      { reason: 'prompt_input_exit', sessionId: 'abc', resume: { id: 'abc' } },
      Object.assign(fromEngine(), { budget: { ms: 1500, remainingMs: 1400 } }),
    );
    expect(telemetry()).toEqual([
      { kind: 'session_end', at: FACT_AT, reason: 'prompt_input_exit', resumeId: 'abc' },
    ]);
  });

  it('drops a measurement that arrives after an exit, but keeps measuring after /clear', async () => {
    mod.answer(204);
    await mod.hook('session.end')(
      mod.engine,
      { reason: 'clear', sessionId: 'a', resume: { id: 'a' } },
      fromEngine(),
    );
    await mod.hook('session.measure')(mod.engine, measure(1, 1), fromEngine());
    mod.answer(204);
    await mod.hook('session.end')(
      mod.engine,
      { reason: 'other', sessionId: 'b', resume: { id: 'b' } },
      fromEngine(),
    );
    await mod.hook('session.measure')(mod.engine, measure(2, 2), fromEngine());
    mod.inbox({ messages: [], notices: [], status: null });
    await mod.tick();
    expect(telemetry().map((item) => (item as { kind: string; costUsd?: number }).kind)).toEqual([
      'session_end',
      'measure',
      'session_end',
    ]);
    expect(telemetry()[1]).toMatchObject({ costUsd: 1 });
  });
});
