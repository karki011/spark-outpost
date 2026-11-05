import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  commandLabel,
  descendantsOf,
  isAlive,
  killProcessTree,
  processKillsSent,
  processTreeNow,
  runningCommand,
  type ProcessRow,
} from './process-group.ts';

async function treeWithStrayJob(): Promise<{ root: number; job: number; stop: () => void }> {
  const child = spawn('/bin/sh', ['-c', 'set -m; sleep 300 & echo $!; wait'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const [line] = (await once(child.stdout, 'data')) as [Buffer];
  const root = child.pid!;
  const job = Number(line.toString().trim());
  const stop = () => {
    for (const pid of [root, job]) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        continue;
      }
    }
  };
  return { root, job, stop };
}

async function gone(pid: number): Promise<boolean> {
  for (let tries = 0; tries < 100 && isAlive(pid); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !isAlive(pid);
}

describe('killing a process tree', () => {
  it('finds a job in its own process group and signals it with the root', async () => {
    const tree = await treeWithStrayJob();
    try {
      expect(processTreeNow(tree.root)).toContain(tree.job);
      await killProcessTree(tree.root, 50);
      expect(await gone(tree.job)).toBe(true);
      expect(await gone(tree.root)).toBe(true);
    } finally {
      tree.stop();
    }
  });

  it('reads the process table before signalling, and shutdown waits for that', async () => {
    const tree = await treeWithStrayJob();
    try {
      void killProcessTree(tree.root, 50);
      expect(isAlive(tree.root)).toBe(true);
      await processKillsSent();
      expect(await gone(tree.job)).toBe(true);
      expect(await gone(tree.root)).toBe(true);
    } finally {
      tree.stop();
    }
  });
});

function row(pid: number, ppid: number, args: string, foregroundGroup = 0): ProcessRow {
  return { pid, ppid, foregroundGroup, args };
}

describe('descendantsOf', () => {
  it('finds children and grandchildren but not unrelated processes', () => {
    const table = [row(10, 1, 'a'), row(11, 10, 'b'), row(12, 11, 'c'), row(13, 10, 'd')];
    expect(descendantsOf(10, [...table, row(20, 1, 'e')]).sort()).toEqual([11, 12, 13]);
  });
});

describe('runningCommand', () => {
  it('is null for a shell waiting at its prompt', () => {
    const table = [row(10, 1, '-zsh', 10), row(20, 1, 'sleep 100')];
    expect(runningCommand(10, table)).toBeNull();
  });

  it('names the foreground job rather than what it started', () => {
    const table = [
      row(10, 1, '-zsh', 31),
      row(30, 10, 'sleep 5'),
      row(31, 10, 'node /Users/me/.local/share/node24/bin/pnpm dev'),
      row(32, 31, 'node /repo/node_modules/.bin/vite'),
    ];
    expect(runningCommand(10, table)).toBe('pnpm dev');
  });

  it('is null while the shell only has a process mid-exec or a finished child', () => {
    const table = [
      row(10, 1, '-bash', 50),
      row(50, 10, '(bash)'),
      row(51, 10, '<defunct>'),
      row(52, 10, '[python3] <defunct>'),
    ];
    expect(runningCommand(10, table)).toBeNull();
  });

  it('falls back to a direct child when nothing is in the foreground', () => {
    const table = [row(10, 1, '-zsh', 10), row(40, 10, '/bin/sleep 100'), row(41, 40, 'x')];
    expect(runningCommand(10, table)).toBe('sleep 100');
  });
});

describe('commandLabel', () => {
  it('shows scripts by name instead of their interpreter', () => {
    expect(commandLabel('/usr/local/bin/python3.12 /opt/tools/serve.py --port 8000')).toBe(
      'serve --port 8000',
    );
    expect(commandLabel('node server.js')).toBe('node server.js');
    expect(commandLabel('/usr/bin/make watch')).toBe('make watch');
  });

  it('shortens very long command lines', () => {
    const label = commandLabel(`tail -f ${'x'.repeat(200)}`);
    expect(label).toHaveLength(60);
    expect(label.endsWith('…')).toBe(true);
  });
});
