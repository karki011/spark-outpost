import { afterEach, describe, expect, it } from 'vitest';
import type { TerminalServerMessage } from '@spark-outpost/contracts';
import { isAlive } from './process-group.ts';
import { loginShellSpawner } from './pty.ts';
import {
  defaultLimits,
  TerminalAuthError,
  TerminalLimitError,
  TerminalSessions,
} from './sessions.ts';

const size = { cols: 80, rows: 24 };
let sessions: TerminalSessions;

afterEach(() => sessions?.killAll());

function start(limits = defaultLimits) {
  sessions = new TerminalSessions(loginShellSpawner('/bin/sh'), limits);
  const created = sessions.create('claude');
  const messages: TerminalServerMessage[] = [];
  const screen = { text: '' };
  let closed = false;
  const client = {
    output: (data: string) => {
      screen.text += data;
    },
    send: (message: TerminalServerMessage) => messages.push(message),
    close: () => {
      closed = true;
    },
  };
  return { created, messages, screen, client, isClosed: () => closed };
}

async function until(check: () => boolean, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the terminal.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function pidOf(text: string): number {
  const match = /PID=(\d+)/.exec(text);
  if (!match) throw new Error('No PID printed.');
  return Number(match[1]);
}

describe('terminal sessions', () => {
  it('types the install command without running it and streams real output', async () => {
    const { created, screen, client } = start();
    expect(created.command).toBe('npm i -g @anthropic-ai/claude-code');
    const terminal = sessions.attach(created.id, created.token, client, size);

    await until(() => screen.text.includes('npm i -g @anthropic-ai/claude-code'));
    expect(screen.text.split('npm i -g @anthropic-ai/claude-code')).toHaveLength(2);
    terminal.input('\u0015echo "spark-$((40 + 2))"\r');
    await until(() => screen.text.includes('spark-42'));
  });

  it('kills the shell and everything it started when closed', async () => {
    const { created, messages, screen, client, isClosed } = start();
    const terminal = sessions.attach(created.id, created.token, client, size);
    terminal.input('\u0015nohup sleep 300 >/dev/null 2>&1 & echo PID=$! \r');
    await until(() => /PID=\d+/.test(screen.text));
    const child = pidOf(screen.text);
    expect(isAlive(child)).toBe(true);

    terminal.close();

    expect(messages.at(-1)).toEqual({ type: 'ended', reason: 'closed', exitCode: null });
    expect(isClosed()).toBe(true);
    await until(() => !isAlive(child));
    expect(sessions.activeCount).toBe(0);
  });

  it('kills the terminal when the page disconnects', async () => {
    const { created, messages, screen, client } = start();
    const terminal = sessions.attach(created.id, created.token, client, size);
    terminal.input('\u0015echo "PID=$$"\r');
    await until(() => /PID=\d+/.test(screen.text));
    const shell = pidOf(screen.text);

    terminal.disconnect();

    await until(() => !isAlive(shell));
    expect(messages.at(-1)).toMatchObject({ type: 'ended', reason: 'disconnected' });
  });

  it('starts with the login command when the CLI is installed but logged out', async () => {
    sessions = new TerminalSessions(loginShellSpawner('/bin/sh'));
    const created = sessions.create('codex', 'login');
    expect(created.command).toBe('codex login');
  });

  it('types the next command after a step finishes, but never over the user', async () => {
    const { created, screen, messages, client } = start({ ...defaultLimits, quietMs: 150 });
    const terminal = sessions.attach(created.id, created.token, client, size);
    const blocked = 'echo "npm warn install-scripts x not yet covered by allowScripts:"';
    await until(() => screen.text.includes('npm i -g'));
    terminal.input(`\u0015${blocked}\r`);
    await until(() => messages.some((message) => message.type === 'hint'));
    await until(() => /allowScripts:[\s\S]*--allow-scripts=/.test(screen.text));

    terminal.input(`\u0015${blocked.replace('x', 'y')}\r`);
    await until(() => screen.text.includes('y not yet covered'));
    terminal.input('ls');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.text.split('y not yet covered').at(-1)).not.toContain('--allow-scripts=');
  });

  it('ends when the shell exits on its own', async () => {
    const { created, messages, client } = start();
    const terminal = sessions.attach(created.id, created.token, client, size);
    terminal.input('\u0015exit 3\r');
    await until(() => messages.some((message) => message.type === 'ended'));
    expect(messages.at(-1)).toEqual({ type: 'ended', reason: 'exited', exitCode: 3 });
  });

  it('ends idle terminals and terminals that were never opened', async () => {
    const idle = start({ ...defaultLimits, idleMs: 150 });
    sessions.attach(idle.created.id, idle.created.token, idle.client, size);
    await until(() => idle.messages.some((message) => message.type === 'ended'));
    expect(idle.messages.at(-1)).toMatchObject({ reason: 'idle' });

    sessions = new TerminalSessions(loginShellSpawner('/bin/sh'), {
      ...defaultLimits,
      tokenTtlMs: 50,
    });
    sessions.create('codex');
    await until(() => sessions.activeCount === 0);
  });

  it('accepts each token once and rejects wrong tokens', () => {
    const { created, client } = start();
    expect(() => sessions.attach(created.id, 'wrong', client, size)).toThrow(TerminalAuthError);
    sessions.attach(created.id, created.token, client, size);
    expect(() => sessions.attach(created.id, created.token, client, size)).toThrow(
      TerminalAuthError,
    );
  });

  it('limits how many terminals can be open at once', () => {
    start({ ...defaultLimits, maxSessions: 1 });
    expect(() => sessions.create('codex')).toThrow(TerminalLimitError);
  });
});
