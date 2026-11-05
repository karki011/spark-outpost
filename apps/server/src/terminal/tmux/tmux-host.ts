import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface TmuxHost {
  bin: string;
  directory: string;
  socket: string;
  configPath: string;
  env: Record<string, string>;
}

export type TmuxChoice =
  { host: TmuxHost; reason: null; version: string } | { host: null; reason: string };

const SOCKET_PATH_MAX_BYTES = 103;
const VERSION = /^tmux \d/;
const VERSION_SHOWN = /^tmux \d[\w.-]{0,30}/;
const DEAD_WINDOW = 'spark-dead';

export function tmuxConfigText(): string {
  return [
    'set -g status off',
    'set -g mouse off',
    'set -g prefix None',
    'set -g prefix2 None',
    'unbind-key -a -T prefix',
    'unbind-key -a -T root',
    'set -g history-limit 50000',
    'set -g remain-on-exit on',
    "set -g remain-on-exit-format ''",
    'set -g focus-events on',
    'set -g window-size latest',
    'set -g visual-bell off',
    'set -g bell-action none',
    'set -g set-titles off',
    'set -g allow-rename off',
    'set -g automatic-rename off',
    'set -g allow-passthrough off',
    'set -g default-terminal xterm-256color',
    'set -s escape-time 0',
    'set -s set-clipboard off',
    'set -s extended-keys on',
    'set -s extended-keys-format csi-u',
    'set -s exit-empty on',
    `set-hook -g pane-died 'run-shell -C "rename-window -t #{window_id} ${DEAD_WINDOW}"'`,
    '',
  ].join('\n');
}

export function tmuxBaseEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return {
    HOME: env.HOME ?? os.homedir(),
    USER: env.USER ?? os.userInfo().username,
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    SHELL: '/bin/sh',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    TERM: 'xterm-256color',
    TMPDIR: env.TMPDIR ?? os.tmpdir(),
  };
}

export function tmuxBinary(env: NodeJS.ProcessEnv, localDir: string | null): string | null {
  if (env.SPARK_TMUX_BIN) return env.SPARK_TMUX_BIN;
  const built = localDir ? join(localDir, 'tmux', process.arch, 'bin', 'tmux') : null;
  return built && existsSync(built) ? built : null;
}

export function checkTmux(
  bin: string,
  env: Record<string, string>,
): { version: string } | { problem: string } {
  try {
    const printed = execFileSync(bin, ['-V'], { env, encoding: 'utf8', timeout: 5_000 });
    return VERSION.test(printed)
      ? { version: VERSION_SHOWN.exec(printed)![0] }
      : { problem: 'its version check printed something else' };
  } catch (error) {
    return { problem: (error as Error).message.split('\n')[0] ?? 'it did not start' };
  }
}

export function tmuxChoiceLine(choice: TmuxChoice): string {
  return choice.host
    ? `Terminal sessions run under tmux (${basename(choice.host.bin)}, ${choice.version}).`
    : `Terminal sessions run without tmux (${choice.reason}); they stop when Spark restarts.`;
}

export function chooseTmux(
  env: NodeJS.ProcessEnv,
  directory: string,
  localDir: string | null,
): TmuxChoice {
  if (env.SPARK_TERMINAL_TMUX === 'off') return { host: null, reason: 'it is turned off' };
  const bin = tmuxBinary(env, localDir);
  if (!bin) return { host: null, reason: 'no tmux binary is bundled or built' };
  const socket = join(directory, 's');
  if (Buffer.byteLength(socket) > SOCKET_PATH_MAX_BYTES)
    return { host: null, reason: 'the data folder path is too long for its socket' };
  const base = tmuxBaseEnv(env);
  const checked = checkTmux(bin, base);
  if ('problem' in checked)
    return { host: null, reason: `tmux failed its check (${checked.problem})` };
  const configPath = join(directory, 'tmux.conf');
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(configPath, tmuxConfigText(), { mode: 0o600 });
  } catch (error) {
    return { host: null, reason: `its folder could not be written (${(error as Error).message})` };
  }
  return {
    host: { bin, directory, socket, configPath, env: base },
    reason: null,
    version: checked.version,
  };
}

export function tmuxArgs(host: TmuxHost, args: readonly string[]): string[] {
  return ['-u', '-S', host.socket, '-f', host.configPath, ...args];
}

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export function tmux(
  host: TmuxHost,
  args: readonly string[],
  env: Record<string, string> = host.env,
): string {
  return execFileSync(host.bin, tmuxArgs(host, args), {
    cwd: host.directory,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: MAX_OUTPUT_BYTES,
  });
}

export async function tryTmuxAsync(
  host: TmuxHost,
  args: readonly string[],
): Promise<string | null> {
  const running = execFileAsync(host.bin, tmuxArgs(host, args), {
    cwd: host.directory,
    env: host.env,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  running.child.stdin?.end();
  return running.then(
    ({ stdout }) => stdout,
    () => null,
  );
}

export function tryTmux(host: TmuxHost, args: readonly string[]): string | null {
  try {
    return tmux(host, args);
  } catch {
    return null;
  }
}

export function killTmuxServer(host: TmuxHost): void {
  tryTmux(host, ['kill-server']);
}
