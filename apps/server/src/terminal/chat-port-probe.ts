import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { childrenByParent, listeningPorts, panePids } from './chat-ports.ts';
import { childrenFromRows, netstatListeners } from './chat-port-windows.ts';
import { processTableOrNull, system32 } from './process-group.ts';
import { tmuxArgs, type TmuxHost } from './tmux/tmux-host.ts';

export interface PortProbe {
  children(): Promise<Map<number, number[]>>;
  listening(pids: readonly number[]): Promise<Map<number, number[]>>;
  panes(): Promise<Map<string, number[]>>;
}

const PROBE_TIMEOUT_MS = 2_000;
const WINDOWS_PROBE_TIMEOUT_MS = 10_000;
const LSOF =
  ['/usr/sbin/lsof', '/usr/bin/lsof'].find((path) => existsSync(path)) ?? '/usr/sbin/lsof';
const PROBE_MAX_BYTES = 8 * 1024 * 1024;

interface Ran {
  stdout: string;
  failed: boolean;
  exitCode: number | null;
}

function run(
  bin: string,
  args: readonly string[],
  options: { cwd?: string; env?: Record<string, string>; timeout?: number } = {},
): Promise<Ran> {
  return new Promise((resolve) => {
    const child = execFile(
      bin,
      args,
      {
        timeout: PROBE_TIMEOUT_MS,
        ...options,
        encoding: 'utf8',
        maxBuffer: PROBE_MAX_BYTES,
        windowsHide: true,
      },
      (error, stdout) =>
        resolve({
          stdout: stdout ?? '',
          failed: error !== null,
          exitCode:
            error === null
              ? 0
              : !error.killed && typeof error.code === 'number'
                ? error.code
                : null,
        }),
    );
    child.stdin?.end();
  });
}

function windowsPortProbe(): PortProbe {
  return {
    async children() {
      const rows = await processTableOrNull();
      if (!rows) throw new Error('Windows could not list processes');
      return childrenFromRows(rows);
    },
    async listening(pids) {
      if (pids.length === 0) return new Map();
      const { stdout, failed } = await run(system32('NETSTAT.EXE'), ['-ano'], {
        timeout: WINDOWS_PROBE_TIMEOUT_MS,
      });
      if (failed) throw new Error('netstat could not list listeners');
      return netstatListeners(stdout, pids);
    },
    panes: () => Promise.resolve(new Map()),
  };
}

export function systemPortProbe(
  tmux: TmuxHost | null,
  platform: NodeJS.Platform = process.platform,
): PortProbe {
  if (platform === 'win32') return windowsPortProbe();
  return {
    async children() {
      const { stdout, failed } = await run('/bin/ps', ['-A', '-o', 'pid=,ppid=']);
      if (failed) throw new Error('ps could not list processes');
      return childrenByParent(stdout);
    },
    async listening(pids) {
      if (pids.length === 0) return new Map();
      const { stdout, failed, exitCode } = await run(LSOF, [
        '-nP',
        '-a',
        '-iTCP',
        '-sTCP:LISTEN',
        '-p',
        pids.join(','),
        '-Fpn',
      ]);
      if (failed && exitCode !== 1) throw new Error('lsof could not list listeners');
      return listeningPorts(stdout);
    },
    async panes() {
      if (!tmux) return new Map();
      const { stdout, failed } = await run(
        tmux.bin,
        tmuxArgs(tmux, ['list-panes', '-a', '-F', '#{session_name} #{pane_pid}']),
        { cwd: tmux.directory, env: tmux.env },
      );
      return failed ? new Map() : panePids(stdout);
    },
  };
}
