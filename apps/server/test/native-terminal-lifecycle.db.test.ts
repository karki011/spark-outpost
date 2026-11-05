import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nativeTerminalRow } from '../src/persistence/native-terminals.ts';
import { actionFacts, actionPath } from '../src/spark-mcp/actions/action-policy.ts';
import { nativeRuntimeFixture, type NativeRuntimeFixture } from './native-terminal-fixture.ts';

let f: NativeRuntimeFixture;
beforeEach(async () => {
  f = await nativeRuntimeFixture();
});
afterEach(async () => {
  await f?.cleanup();
});

const row = async () => (await nativeTerminalRow(f.t.db, f.conversationId))!;
const updatedAt = async () =>
  (
    await f.t.db.query<{ updated_at: Date }>('SELECT updated_at FROM conversations WHERE id = $1', [
      f.conversationId,
    ])
  ).rows[0]!.updated_at.getTime();

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

  it('never stores a provider session id that could be read as a command-line option', async () => {
    await f.launch();
    for (const session_id of ['--dangerously-skip-permissions', '-c', 'two words', 'a/b', ''])
      expect(await f.hook('SessionStart', { session_id })).toBe(400);
    expect((await row()).native_session_id).toBeNull();
    await f.t.db.query(
      `UPDATE native_terminal_sessions SET native_session_id = '--dangerously-skip-permissions'`,
    );
    await f.runtime.stop(f.conversationId);
    await expect(f.runtime.launch(f.conversationId, { resume: true })).rejects.toThrow(
      'no native session to resume',
    );
    expect(f.spawn).toHaveBeenCalledTimes(1);
  });

  it('registers no hook credential when lifecycle observation is unsupported', async () => {
    f.observation = 'unsupported';
    await f.launch();
    expect(await f.hook('SessionStart')).toBe(401);
    expect((await row()).state).toBe('unknown');
  });

  it('leaves the conversation untouched when a hook event changes nothing', async () => {
    await f.launch();
    await f.hook('SessionStart');
    expect(await f.hook('PreToolUse')).toBe(204);
    const before = await updatedAt();
    const rowBefore = (await row()).updated_at.getTime();
    expect(await f.hook('PostToolUse')).toBe(204);
    expect(await f.hook('PreToolUse')).toBe(204);
    expect(await updatedAt()).toBe(before);
    expect((await row()).updated_at.getTime()).toBe(rowBefore);
    expect(await f.hook('PermissionRequest')).toBe(204);
    expect(await updatedAt()).toBeGreaterThan(before);
  });

  it('records no mode as used until a hook reports one, and Spark actions ask until then', async () => {
    await f.t.db.query(
      `UPDATE conversations SET overrides = '{"claude":{"agentMode":"auto","level":"hands-off"}}'::jsonb`,
    );
    await f.launch();
    const runId = (await f.t.db.query<{ id: string }>('SELECT id FROM runs')).rows[0]!.id;
    const recorded = async () =>
      (
        await f.t.db.query<{ agent_mode: string; used_mode: string | null }>(
          'SELECT agent_mode, used_mode FROM runs WHERE id = $1',
          [runId],
        )
      ).rows[0]!;
    const path = async () => actionPath(await actionFacts(f.t.db, runId, 'create_ticket'));

    expect(f.inputs[0]!.agentMode).toBe('auto');
    expect(await recorded()).toEqual({ agent_mode: 'auto', used_mode: null });
    expect(await path()).toBe('confirm');

    expect(await f.hook('SessionStart', { permission_mode: 'auto' })).toBe(204);
    expect(await recorded()).toEqual({ agent_mode: 'auto', used_mode: 'auto' });
    expect(await path()).toBe('perform');
  });
});
