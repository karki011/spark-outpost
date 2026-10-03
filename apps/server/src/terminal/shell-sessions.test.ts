import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TerminalServerMessage } from '@spark-outpost/contracts';
import { isAlive } from './process-group.ts';
import { loginShellSpawner } from './pty.ts';
import type { OpenShell } from '../persistence/terminal-shells.ts';
import { defaultLimits, TerminalLimitError, TerminalSessions } from './sessions.ts';

const size = { cols: 80, rows: 24 };
let sessions: TerminalSessions;
let folder: string;

beforeEach(() => {
  folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'spark-shell-')));
});

afterEach(() => {
  sessions?.killAll();
  rmSync(folder, { recursive: true, force: true });
});

function recorder() {
  const messages: TerminalServerMessage[] = [];
  const screen = { text: '' };
  const client = {
    output: (data: string) => {
      screen.text += data;
    },
    send: (message: TerminalServerMessage) => messages.push(message),
    close: () => undefined,
  };
  return { messages, screen, client };
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the terminal.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function useLimits(limits = defaultLimits) {
  sessions = new TerminalSessions(loginShellSpawner('/bin/sh'), limits);
}

function openShell(conversationId: string | null, cwd = folder) {
  const created = sessions.createShell({ cwd, conversationId });
  const recorded = recorder();
  const terminal = sessions.attach(created.id, created.token, recorded.client, size);
  return { created, terminal, ...recorded };
}

describe('chat shells', () => {
  it('starts a login shell in the given folder without typing anything', async () => {
    useLimits();
    const shell = openShell(null);
    expect(shell.created).not.toHaveProperty('command');
    shell.terminal.input('echo "at:$(pwd)"\r');
    await until(() => shell.screen.text.includes(`at:${folder}`));
    expect(shell.screen.text).not.toContain('npm i -g');
  });

  it('stays open without input, unlike setup terminals', async () => {
    useLimits({ ...defaultLimits, idleMs: 50, maxMs: 80 });
    const shell = openShell(null);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(shell.messages).toEqual([]);
    expect(sessions.activeCount).toBe(1);
  });

  it('ends only the shells of a removed chat, with a reason the page can show', async () => {
    useLimits();
    const first = openShell('chat-a');
    const second = openShell('chat-a');
    const other = openShell('chat-b');
    first.terminal.input('echo "PID=$$"\r');
    await until(() => /PID=\d+/.test(first.screen.text));
    const pid = Number(/PID=(\d+)/.exec(first.screen.text)![1]);

    expect(sessions.endChat('chat-a')).toBe(2);

    expect(first.messages.at(-1)).toEqual({
      type: 'ended',
      reason: 'chat_removed',
      exitCode: null,
    });
    expect(second.messages.at(-1)).toMatchObject({ reason: 'chat_removed' });
    expect(other.messages).toEqual([]);
    await until(() => !isAlive(pid));
    expect(sessions.activeCount).toBe(1);
  });

  it('ends a shell when its folder is removed', async () => {
    const inner = path.join(folder, 'worktree');
    mkdirSync(inner);
    useLimits({ ...defaultLimits, folderCheckMs: 30 });
    const shell = openShell('chat-a', inner);
    shell.terminal.input('echo "ready-$((1 + 1))"\r');
    await until(() => shell.screen.text.includes('ready-2'));
    rmSync(inner, { recursive: true, force: true });
    await until(() => shell.messages.some((message) => message.type === 'ended'));
    expect(shell.messages.at(-1)).toMatchObject({ reason: 'folder_removed' });
  });

  it('reports the command a shell is running, and nothing once it finishes', async () => {
    useLimits();
    const shell = openShell(null);
    shell.terminal.input('echo "ready-$((2 + 2))"\r');
    await until(() => shell.screen.text.includes('ready-4'));
    expect(await sessions.runningCommand(shell.created.id)).toBeNull();

    shell.terminal.input('sleep 100\r');
    await until(async () => (await sessions.runningCommand(shell.created.id)) === 'sleep 100');

    shell.terminal.input('\x03');
    await until(async () => (await sessions.runningCommand(shell.created.id)) === null);
    expect(await sessions.runningCommand('not-a-session')).toBeNull();
  }, 30_000);

  it('tells the watcher when a shell starts and ends, but not about setup terminals', async () => {
    const opened: OpenShell[] = [];
    const ended: string[] = [];
    sessions = new TerminalSessions(loginShellSpawner('/bin/sh'), defaultLimits, {
      opened: (shell) => opened.push(shell),
      ended: (id) => ended.push(id),
    });
    const created = sessions.createShell({ cwd: folder, conversationId: 'chat-a', label: 'app' });
    const setup = sessions.create('claude');
    expect(opened).toEqual([]);

    const terminal = sessions.attach(created.id, created.token, recorder().client, size);
    sessions.attach(setup.id, setup.token, recorder().client, size);
    expect(opened).toEqual([
      {
        id: created.id,
        conversationId: 'chat-a',
        label: 'app',
        cwd: folder,
        pid: expect.any(Number),
      },
    ]);
    expect(isAlive(opened[0]!.pid)).toBe(true);

    terminal.close();
    sessions.kill(setup.id);
    expect(ended).toEqual([created.id]);
  });

  it('counts shells separately from setup terminals', () => {
    useLimits({ ...defaultLimits, maxSessions: 1, maxShells: 2 });
    sessions.create('claude');
    sessions.createShell({ cwd: folder, conversationId: null });
    sessions.createShell({ cwd: folder, conversationId: null });
    expect(() => sessions.createShell({ cwd: folder, conversationId: null })).toThrow(
      TerminalLimitError,
    );
    expect(() => sessions.create('codex')).toThrow(TerminalLimitError);
  });
});
