import { execFile } from 'node:child_process';
import { childrenByParent, listeningPorts, panePids } from './chat-ports.ts';
import { tmuxArgs, type TmuxHost } from './tmux/tmux-host.ts';

export interface PortProbe {
  children(): Promise<Map<number, number[]>>;
  listening(pids: readonly number[]): Promise<Map<number, number[]>>;
  panes(): Promise<Map<string, number[]>>;
}

const PROBE_TIMEOUT_MS = 2_000;
const PROBE_MAX_BYTES = 8 * 1024 * 1024;

interface Ran {
  stdout: string;
  failed: boolean;
}

function run(
  bin: string,
  args: readonly string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<Ran> {
  return new Promise((resolve) => {
    const child = execFile(
      bin,
      args,
      { ...options, encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BYTES },
      (error, stdout) => resolve({ stdout: stdout ?? '', failed: error !== null }),
    );
    child.stdin?.end();
  });
}

export function systemPortProbe(tmux: TmuxHost | null): PortProbe {
  return {
    async children() {
      const { stdout, failed } = await run('/bin/ps', ['-A', '-o', 'pid=,ppid=']);
      if (failed) throw new Error('ps could not list processes');
      return childrenByParent(stdout);
    },
    async listening(pids) {
      if (pids.length === 0) return new Map();
      const { stdout } = await run('/usr/sbin/lsof', [
        '-nP',
        '-a',
        '-iTCP',
        '-sTCP:LISTEN',
        '-p',
        pids.join(','),
        '-Fpn',
      ]);
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
