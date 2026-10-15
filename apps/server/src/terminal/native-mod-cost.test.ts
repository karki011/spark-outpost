import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fromEngine, startSparkMod, type SparkModHarness } from '../../test/spark-mod-engine.ts';
import { MOD_SIDE_INDEX } from './native-mod-telemetry-script.ts';

let mod: SparkModHarness;

beforeEach(async () => {
  mod = await startSparkMod();
});

afterEach(async () => {
  await mod.cleanup();
});

const usage = {
  input_tokens: 1,
  output_tokens: 1,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  model: 'claude-opus-5-5',
};

async function started(turnId: string, agentId?: string) {
  await mod.hook('turn.start')(
    mod.engine,
    { turnId, ...(agentId ? { agentId } : {}) },
    fromEngine(),
  );
}

async function pollOnce() {
  mod.inbox({ messages: [], notices: [], status: null });
  mod.answer(204);
  await mod.tick();
}

const requestCosts = (index: number) =>
  mod
    .sentItems(index)
    .items.filter((item) => item.kind === 'request')
    .map((item) => item.costUsd);

describe('the cost the Spark mod reads from Claude Code', () => {
  it('is read one request at a time, so overlapping requests never count twice', async () => {
    await mod.hook('classic.UserPromptSubmit')(mod.engine, { prompt_id: 'p' }, fromEngine());
    await started('main');
    await started('sub', 'agent-a');
    let release = () => undefined as void;
    const held = new Promise<void>((done) => (release = done));
    let calls = 0;
    let ledger = 0;
    mod.engine.session.usage = async () => {
      calls += 1;
      const seen = ledger;
      if (calls === 1) await held;
      return { cost: { usd: seen } };
    };
    ledger = 0.1;
    const first = mod.step({ turnId: 'main', index: 0 }, usage);
    await new Promise((done) => setTimeout(done, 0));
    ledger = 0.25;
    const second = mod.step({ turnId: 'sub', index: 0, agentId: 'agent-a' }, usage);
    await new Promise((done) => setTimeout(done, 0));
    expect(calls).toBe(1);
    release();
    await Promise.all([first, second]);
    await pollOnce();
    expect(requestCosts(1)).toEqual([0.1, 0.15]);
  });

  it('spent before the first turn goes to that turn’s first request', async () => {
    mod.spend(0.03);
    mod.inbox({ messages: [], notices: [], status: null });
    await mod.tick();
    mod.spend(0.28);
    await mod.hook('classic.UserPromptSubmit')(mod.engine, { prompt_id: 'p' }, fromEngine());
    await started('first');
    await mod.step({ turnId: 'first', index: 0 }, usage);
    await pollOnce();
    expect(requestCosts(2)).toEqual([0.28]);
  });

  it('spent between turns goes to the turn that just ended, read while the session is idle', async () => {
    await mod.hook('classic.UserPromptSubmit')(mod.engine, { prompt_id: 'p' }, fromEngine());
    await started('first');
    mod.spend(0.25);
    await mod.step({ turnId: 'first', index: 0 }, usage);
    await mod.hook('turn.complete')(
      mod.engine,
      { turnId: 'first', durationMs: 5, isAborted: false },
      fromEngine(),
    );
    await pollOnce();
    mod.spend(0.27);
    await pollOnce();
    expect(mod.sentItems(3).items).toEqual([
      expect.objectContaining({ turn: 'first', index: MOD_SIDE_INDEX, output: 0, costUsd: 0.02 }),
    ]);
  });

  it('spent by a turn stopped before any step finished goes to that turn, not the one before', async () => {
    await mod.hook('classic.UserPromptSubmit')(mod.engine, { prompt_id: 'p1' }, fromEngine());
    await started('first');
    mod.spend(0.25);
    await mod.step({ turnId: 'first', index: 0, model: 'claude-opus-5-5' }, usage);
    await mod.hook('turn.complete')(mod.engine, { turnId: 'first', durationMs: 5 }, fromEngine());
    await mod.hook('classic.UserPromptSubmit')(mod.engine, { prompt_id: 'p2' }, fromEngine());
    await started('second');
    mod.spend(0.3);
    await mod.step({ turnId: 'second', index: 0, model: 'claude-opus-5-5' }, null);
    await mod.hook('turn.complete')(
      mod.engine,
      { turnId: 'second', durationMs: 5, isAborted: true },
      fromEngine(),
    );
    await pollOnce();
    const filed = mod.sentItems(1).items.filter((item) => item.kind === 'request');
    expect(filed.map((item) => [item.turn, item.index, item.costUsd])).toEqual([
      ['first', 0, 0.25],
      ['second', MOD_SIDE_INDEX, 0.05],
    ]);
  });
});
