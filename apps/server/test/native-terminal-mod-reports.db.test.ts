import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setModHealth } from '../src/persistence/native-terminal-mod-reports.ts';
import { nativeTerminalRow } from '../src/persistence/native-terminals.ts';
import { nativeRuntimeFixture, type NativeRuntimeFixture } from './native-terminal-fixture.ts';

let f: NativeRuntimeFixture;
beforeEach(async () => {
  f = await nativeRuntimeFixture();
});
afterEach(async () => {
  await f?.cleanup();
});

const AT = 1_792_000_000_000;
const measure = (at: number, percentUsed: number) => ({
  kind: 'measure',
  at,
  context: { tokens: 40_000, window: 200_000, percent: 20 },
  rateLimits: [
    { kind: 'five_hour', percentUsed, resetsAt: '2026-11-18T20:00:00Z' },
    { kind: 'seven_day', percentUsed: 7, resetsAt: null },
  ],
  costUsd: 1.5,
});
const ended = (reason: string, resumeId: string | null, at = AT) => ({
  kind: 'session_end',
  at,
  reason,
  resumeId,
});

describe('what the Spark mod measures', () => {
  it('keeps the latest rate-limit windows for the Terminal cost pane and ignores an older one', async () => {
    await f.launch();
    expect(await f.modFacts([measure(AT, 20)])).toBe(204);
    expect(await f.modFacts([measure(AT + 5000, 31.5)])).toBe(204);
    expect(await f.modFacts([measure(AT + 1000, 25)])).toBe(204);
    expect((await f.runtime.usage(f.conversationId)).measure).toEqual({
      at: new Date(AT + 5000).toISOString(),
      context: { tokens: 40_000, window: 200_000, percent: 20 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 31.5, resetsAt: '2026-11-18T20:00:00Z' },
        { kind: 'seven_day', percentUsed: 7, resetsAt: null },
      ],
      costUsd: 1.5,
    });
  });

  it('drops a measurement with a field Spark does not know, keeping the rest of the batch', async () => {
    await f.launch();
    expect(await f.modFacts([{ ...measure(AT, 1), extra: true }, measure(AT, 2)])).toBe(204);
    expect((await f.runtime.usage(f.conversationId)).measure?.rateLimits[0]?.percentUsed).toBe(2);
  });
});

describe('why a Terminal session ended', () => {
  it('records the reason and the resume id the mod reports', async () => {
    await f.launch();
    await f.modFacts([ended('prompt_input_exit', 'native-provider-session')]);
    expect((await f.runtime.get(f.conversationId))?.ended).toEqual({
      reason: 'prompt_input_exit',
      resumeId: 'native-provider-session',
      at: new Date(AT).toISOString(),
    });
  });

  it('never stores a resume id that could be read as an option, and keeps the later end', async () => {
    await f.launch();
    await f.modFacts([ended('clear', 'first-session', AT + 2000)]);
    await f.modFacts([ended('other', '--dangerous', AT + 3000)]);
    await f.modFacts([ended('resume', 'stale', AT + 1000)]);
    expect((await f.runtime.get(f.conversationId))?.ended).toMatchObject({
      reason: 'other',
      resumeId: 'first-session',
    });
  });

  it('records the reason from Claude’s own SessionEnd hook when no mod is loaded', async () => {
    await f.launch();
    await f.hook('SessionStart', { source: 'startup' });
    await f.hook('SessionEnd', { reason: 'logout' });
    expect((await f.runtime.get(f.conversationId))?.ended).toMatchObject({
      reason: 'logout',
      resumeId: 'native-provider-session',
    });
  });
});

describe('whether the Spark mod loaded', () => {
  it('shows the mod as loaded once it checks in, with the Stop it supports', async () => {
    await f.launch();
    expect((await f.runtime.get(f.conversationId))?.mod).toBeNull();
    const reply = await f.modPost('/mod/inbox', { abort: true });
    expect(await reply.json()).toMatchObject({ abort: null, askNotice: null });
    await new Promise((done) => setTimeout(done, 50));
    expect((await f.runtime.get(f.conversationId))?.mod).toEqual({
      state: 'loaded',
      reason: null,
    });
  });

  it('keeps a check-in for the launch when a late missing report lands after it', async () => {
    await f.launch();
    const row = (await nativeTerminalRow(f.t.db, f.conversationId))!;
    expect(await setModHealth(f.t.db, row, 'loaded', null)).toBe(true);
    expect(await setModHealth(f.t.db, row, 'missing', 'late')).toBe(false);
    expect((await f.runtime.get(f.conversationId))?.mod).toEqual({ state: 'loaded', reason: null });
  });
});
