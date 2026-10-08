import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nativeTerminalRow } from '../src/persistence/native-terminals.ts';
import { NativeTerminalConflictError } from '../src/persistence/native-terminal-turns.ts';
import { NativeRuntimeError } from '../src/terminal/native-control.ts';
import { TerminalLimitError } from '../src/terminal/sessions.ts';
import { nativeRuntimeFixture, type NativeRuntimeFixture } from './native-terminal-fixture.ts';

let f: NativeRuntimeFixture;
beforeEach(async () => {
  f = await nativeRuntimeFixture({ maxShells: 1 });
});
afterEach(async () => {
  await f?.cleanup();
});

const runs = async () =>
  (
    await f.t.db.query<{ status: string; error: string | null }>(
      'SELECT status, error FROM runs ORDER BY created_at',
    )
  ).rows;
const messages = async () => (await f.t.db.query('SELECT id FROM messages')).rowCount;

describe('native terminal launch recovery', () => {
  it('starts again with the saved first message after the terminal limit refused the launch', async () => {
    const request = { prompt: 'Check the native fixture', messageId: randomUUID(), resume: false };
    const shell = f.terminals.createShell({ cwd: '/tmp', conversationId: null });
    await expect(f.runtime.launch(f.conversationId, request)).rejects.toBeInstanceOf(
      TerminalLimitError,
    );
    expect(await nativeTerminalRow(f.t.db, f.conversationId)).toMatchObject({
      state: 'error',
      native_session_id: null,
      reason: 'Close a terminal before starting another agent.',
    });
    expect(await runs()).toEqual([
      { status: 'failed', error: 'Close a terminal before starting another agent.' },
    ]);
    f.terminals.kill(shell.id);
    const started = await f.runtime.launch(f.conversationId, request);
    expect(started.session.state).toBe('unknown');
    expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(f.inputs.at(-1)!.prompt).toContain('Check the native fixture');
    expect(f.inputs.at(-1)!.resumeSessionId).toBeUndefined();
    expect(await runs()).toEqual([{ status: 'running', error: null }]);
    expect(await messages()).toBe(1);
  });

  it('reports a plain typed error when the workspace cannot be prepared and retries without retyping', async () => {
    const place = f.place;
    f.place = async () => {
      throw new Error('fatal: could not create work tree dir /private/secret/path');
    };
    const failure = await f.launch().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NativeRuntimeError);
    expect((failure as Error).message).toBe('The terminal could not start. Try again.');
    expect(await nativeTerminalRow(f.t.db, f.conversationId)).toBeNull();
    expect(await runs()).toEqual([
      { status: 'failed', error: 'The terminal could not start. Try again.' },
    ]);
    f.place = place;
    const started = await f.runtime.launch(f.conversationId, { resume: false });
    expect(started.session.runId).not.toBeNull();
    expect(f.inputs.at(-1)!.prompt).toContain('Check the native fixture');
    expect(await runs()).toEqual([{ status: 'running', error: null }]);
    expect(await messages()).toBe(1);
  });

  it('does not start a launch the user stopped again without a new message', async () => {
    let release: (() => void) | null = null;
    const place = f.place;
    f.place = async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return place(...args);
    };
    const pending = f.launch().catch((error: unknown) => error);
    await expect.poll(() => release).not.toBeNull();
    const stopping = f.runtime.stop(f.conversationId);
    await expect.poll(async () => (await runs())[0]?.status).toBe('cancelled');
    release!();
    await stopping;
    expect(await pending).toBeInstanceOf(NativeRuntimeError);
    expect((await runs())[0]!.status).toBe('cancelled');
    f.place = place;
    await expect(f.runtime.launch(f.conversationId, { resume: false })).rejects.toThrow(
      'first message',
    );
    expect(f.spawn).not.toHaveBeenCalled();
  });

  it('refuses to hand out a connection for a terminal process that already ended', async () => {
    const first = await f.launch();
    f.terminals.kill(first.session.id);
    await expect(f.runtime.launch(f.conversationId, { resume: false })).rejects.toBeInstanceOf(
      NativeTerminalConflictError,
    );
  });
});
