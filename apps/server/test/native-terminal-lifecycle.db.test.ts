import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nativeTerminalRow } from '../src/persistence/native-terminals.ts';
import { nativeRuntimeFixture, type NativeRuntimeFixture } from './native-terminal-fixture.ts';

let f: NativeRuntimeFixture;
beforeEach(async () => {
  f = await nativeRuntimeFixture();
});
afterEach(async () => {
  await f?.cleanup();
});

const row = async () => (await nativeTerminalRow(f.t.db, f.conversationId))!;
describe('native terminal provider session lifecycle', () => {
  it('keeps the process running when the provider session ends and adopts the session that follows', async () => {
    await f.launch();
    expect(await f.hook('SessionStart')).toBe(204);
    expect(await f.hook('SessionEnd', { reason: 'clear' })).toBe(204);
    expect(f.terminals.activeCount).toBe(1);
    expect((await row()).state).toBe('ready');
    expect(
      (await f.t.db.query('SELECT status, error FROM runs')).rows.map((run) => run.status),
    ).toEqual(['outcome_unknown']);
    expect(await f.hook('SessionStart', { session_id: 'cleared-session' })).toBe(204);
    expect(await row()).toMatchObject({ state: 'ready', native_session_id: 'cleared-session' });
    expect(
      await f.hook('UserPromptSubmit', { session_id: 'cleared-session', prompt: 'After clear' }),
    ).toBe(204);
    expect((await row()).state).toBe('working');
    expect(await f.hook('Stop')).toBe(400);
    f.exits[0]!({ exitCode: 0 });
    await expect.poll(async () => (await row()).state).toBe('exited');
    expect((await row()).native_session_id).toBe('cleared-session');
  });

  it('refuses another provider session id while the current one has not ended', async () => {
    await f.launch();
    await f.hook('SessionStart');
    expect(await f.hook('SessionStart', { session_id: 'someone-else' })).toBe(400);
    expect(await f.hook('SessionEnd', { reason: 'clear' })).toBe(204);
    expect(
      await f.hook('UserPromptSubmit', { session_id: 'someone-else', prompt: 'Not a start' }),
    ).toBe(400);
    expect((await row()).native_session_id).toBe('native-provider-session');
  });
});
