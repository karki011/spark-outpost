import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSecretEnvName } from '../../setup/environment.ts';
import { killProcessTree } from '../process-group.ts';
import type { StartObserver } from '../start-timing.ts';
import { tmux, tryTmux, type TmuxHost } from './tmux-host.ts';

const PREFIX = 'spark-';
const SESSION_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PANE_FORMAT =
  '#{pane_id} #{pane_pid} #{pane_dead} #{pane_width} #{pane_height} [#{pane_dead_status}] [#{pane_dead_signal}]';
const RESTORED = ['SHELL', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION'];
const HELD_START = [
  'stty -echo',
  'IFS= read -r _',
  'stty echo',
  'unset TMUX TMUX_PANE OLDPWD',
  'cd -- "$1" || exit 1',
  `for name in ${RESTORED.join(' ')}; do shift; if [ -n "$1" ]; then export "$name=$1"; else unset "$name"; fi; done`,
  'shift',
  'exec "$@"',
].join('; ');

export const RELEASE_HELD_START = '0a';

export interface TmuxPane {
  paneId: string;
  pid: number;
  dead: boolean;
  exitCode: number | null;
  signal: number | null;
  cols: number;
  rows: number;
}

export interface TmuxStart {
  sessionId: string;
  cols: number;
  rows: number;
  cwd: string;
  command: string;
  args: readonly string[];
  env: Record<string, string>;
  observer?: StartObserver;
}

export const sessionName = (sessionId: string) => `${PREFIX}${sessionId}`;

const target = (sessionId: string) => `=${sessionName(sessionId)}:`;

function quoted(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function bracketed(value: string | undefined): number | null {
  const inner = value?.slice(1, -1) ?? '';
  return inner === '' ? null : Number(inner);
}

export function parsePane(line: string): TmuxPane | null {
  const [paneId = '', pid, dead, cols, rows, status, signal] = line.trim().split(' ');
  if (!paneId.startsWith('%')) return null;
  const isDead = dead === '1';
  return {
    paneId,
    pid: Number(pid),
    dead: isDead,
    exitCode: isDead ? bracketed(status) : null,
    signal: isDead ? bracketed(signal) : null,
    cols: Number(cols),
    rows: Number(rows),
  };
}

export function paneQuery(paneId: string): string {
  return `display-message -p -t ${paneId} '${PANE_FORMAT}'`;
}

export function readPane(host: TmuxHost, sessionId: string): TmuxPane | null {
  const line = tryTmux(host, ['display-message', '-p', '-t', target(sessionId), PANE_FORMAT]);
  return line ? parsePane(line) : null;
}

export function secretEnvNames(env: Record<string, string>): string[] {
  return Object.keys(env).filter((name) => ENV_NAME.test(name) && isSecretEnvName(name));
}

export function launchCommand(start: TmuxStart): string {
  if (!SESSION_ID.test(start.sessionId)) throw new Error('Invalid terminal session identity.');
  const env = Object.entries(start.env).filter(([name]) => ENV_NAME.test(name));
  return [
    'new-session -d',
    `-s ${quoted(sessionName(start.sessionId))}`,
    `-x ${Math.trunc(start.cols)} -y ${Math.trunc(start.rows)}`,
    ...env.map(([name, value]) => `-e ${quoted(`${name}=${value}`)}`),
    '--',
    ...[
      '/bin/sh',
      '-c',
      HELD_START,
      'spark-terminal',
      start.cwd,
      ...RESTORED.map((name) => start.env[name] ?? ''),
      start.command,
      ...start.args,
    ].map(quoted),
  ].join(' ');
}

function clientEnv(host: TmuxHost, start: TmuxStart): Record<string, string> {
  return start.env.PATH ? { ...host.env, PATH: start.env.PATH } : host.env;
}

export function createSession(host: TmuxHost, start: TmuxStart): TmuxPane {
  const file = join(host.directory, `launch-${randomUUID()}.tmux`);
  writeFileSync(file, `${launchCommand(start)}\n`, { mode: 0o600, flag: 'wx' });
  try {
    tmux(host, ['start-server', ';', 'source-file', file], clientEnv(host, start));
  } finally {
    rmSync(file, { force: true });
  }
  const pane = readPane(host, start.sessionId);
  if (!pane) throw new Error('tmux did not start the terminal session.');
  return pane;
}

export function killSession(host: TmuxHost, sessionId: string, pid: number | null): void {
  if (pid !== null) killProcessTree(pid);
  tryTmux(host, ['kill-session', '-t', `=${sessionName(sessionId)}`]);
}

export function killSessionTree(host: TmuxHost, sessionId: string): void {
  const pane = readPane(host, sessionId);
  killSession(host, sessionId, pane && !pane.dead ? pane.pid : null);
}

export function listSessionIds(host: TmuxHost): string[] {
  const output = tryTmux(host, ['list-sessions', '-F', '#{session_name}']);
  if (!output) return [];
  return output
    .split('\n')
    .filter((name) => name.startsWith(PREFIX))
    .map((name) => name.slice(PREFIX.length));
}

export function killUnknownSessions(host: TmuxHost): void {
  const output = tryTmux(host, ['list-sessions', '-F', '#{session_name}']);
  for (const name of (output ?? '').split('\n').filter(Boolean)) {
    if (!name.startsWith(PREFIX)) tryTmux(host, ['kill-session', '-t', `=${name}`]);
  }
}
