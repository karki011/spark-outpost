import { join } from 'node:path';
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

const transcript_path = join('/fixture/projects', 'native-provider-session.jsonl');
const state = async () => (await nativeTerminalRow(f.t.db, f.conversationId))!.state;
const runs = async () =>
  (
    await f.t.db.query<{ status: string; error: string | null }>(
      'SELECT status, error FROM runs WHERE conversation_id = $1 ORDER BY created_at',
      [f.conversationId],
    )
  ).rows;
const prompt = (prompt_id: string, extra: Record<string, unknown> = {}) =>
  f.hook('UserPromptSubmit', {
    prompt: `Prompt ${prompt_id}`,
    prompt_id,
    transcript_path,
    ...extra,
  });
const cancelled = { status: 'cancelled', error: 'Interrupted in the native terminal.' };

describe('native terminal interrupt from the Claude transcript', () => {
  it('closes the open turn as cancelled, shows ready and starts the next prompt normally', async () => {
    await f.launch();
    await f.hook('SessionStart', { transcript_path });
    await prompt('first');
    expect(await state()).toBe('working');
    expect(f.watchers.map((watcher) => watcher.path)).toEqual([transcript_path]);
    await f.watchers[0]!.interrupt('first');
    expect(await state()).toBe('ready');
    expect(await runs()).toEqual([cancelled]);
    expect(f.watchers[0]!.close).toHaveBeenCalledTimes(1);
    await prompt('second');
    expect(await state()).toBe('working');
    expect(f.watchers).toHaveLength(2);
    expect(await f.hook('Stop', { prompt_id: 'second' })).toBe(204);
    expect(await runs()).toMatchObject([cancelled, { status: 'succeeded' }]);
    expect(f.watchers[1]!.close).toHaveBeenCalledTimes(1);
  });

  it('ignores an interrupt record of an earlier turn and a repeated delivery', async () => {
    await f.launch();
    await f.hook('SessionStart', { transcript_path });
    await prompt('first');
    await f.watchers[0]!.interrupt('first');
    await f.watchers[0]!.interrupt('first');
    await prompt('second');
    await f.watchers[0]!.interrupt('first');
    await f.watchers[1]!.interrupt('first');
    expect(await state()).toBe('working');
    expect(await runs()).toMatchObject([cancelled, { status: 'running' }]);
    await f.watchers[1]!.interrupt('second');
    await f.watchers[1]!.interrupt('second');
    expect(await runs()).toEqual([cancelled, cancelled]);
    expect((await f.t.db.query('SELECT 1 FROM native_terminal_events')).rowCount).toBe(5);
    expect(await f.hook('Stop', { prompt_id: 'second' })).toBe(204);
    expect(await runs()).toEqual([cancelled, cancelled]);
    expect(await state()).toBe('ready');
  });

  it('does not close a turn whose prompt id the provider never reported', async () => {
    await f.launch();
    await f.hook('SessionStart', { transcript_path });
    await f.hook('UserPromptSubmit', { prompt: 'No prompt id', transcript_path });
    await f.watchers[0]!.interrupt('unknown');
    expect(await state()).toBe('working');
  });

  it('watches only the transcript named after the reported provider session', async () => {
    await f.launch();
    await f.hook('SessionStart');
    await prompt('first', { transcript_path: '/fixture/projects/another-session.jsonl' });
    await f.hook('PreToolUse', { prompt_id: 'first', transcript_path: 'relative.jsonl' });
    expect(f.watchers).toHaveLength(0);
    await f.hook('PostToolUse', { prompt_id: 'first', transcript_path });
    expect(f.watchers.map((watcher) => watcher.path)).toEqual([transcript_path]);
  });

  it('stops watching when the provider session or the process ends and ignores a late record', async () => {
    await f.launch();
    await f.hook('SessionStart', { transcript_path });
    await prompt('first');
    await f.hook('SessionEnd', { reason: 'clear' });
    expect(f.watchers[0]!.close).toHaveBeenCalledTimes(1);
    await f.hook('SessionStart', { session_id: 'cleared-session' });
    const cleared = join('/fixture/projects', 'cleared-session.jsonl');
    await f.hook('UserPromptSubmit', {
      session_id: 'cleared-session',
      prompt: 'After clear',
      prompt_id: 'second',
      transcript_path: cleared,
    });
    expect(f.watchers.map((watcher) => watcher.path)).toEqual([transcript_path, cleared]);
    f.exits[0]!({ exitCode: 0 });
    await expect.poll(state).toBe('exited');
    expect(f.watchers[1]!.close).toHaveBeenCalledTimes(1);
    await f.watchers[1]!.interrupt('second');
    expect(await state()).toBe('exited');
    expect(await runs()).toMatchObject([
      { status: 'outcome_unknown' },
      { status: 'outcome_unknown' },
    ]);
  });

  it('keeps the Spark note out of the first message and passes it as launch instructions', async () => {
    await f.launch();
    expect(f.inputs[0]!.prompt).toBe('Check the native fixture');
    expect(f.inputs[0]!.instructions).toContain('This is a Spark Terminal session.');
    const { rows } = await f.t.db.query<{ content: string }>(
      `SELECT content FROM messages WHERE conversation_id = $1 AND role = 'user'`,
      [f.conversationId],
    );
    expect(rows).toEqual([{ content: 'Check the native fixture' }]);
    await f.hook('SessionStart');
    await f.runtime.stop(f.conversationId);
    await f.runtime.launch(f.conversationId, { resume: true });
    expect(f.inputs[1]!.prompt).toBe('');
    expect(f.inputs[1]!.instructions).toContain('This is a Spark Terminal session.');
  });
});
