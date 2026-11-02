import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import setup, { processesUsing } from './vitest-tmpdir.ts';

function exited(child: ReturnType<typeof spawn>): Promise<NodeJS.Signals | null> {
  return new Promise((resolve) => child.once('exit', (_code, signal) => resolve(signal)));
}

describe('processesUsing', () => {
  it('picks processes whose command line names the folder, never this process', () => {
    const folder = '/var/folders/ab/T/sv-abc';
    const rows = [
      { pid: 10, ppid: 1, pgid: 10, command: `node server.js --data ${folder}/run-1` },
      { pid: 11, ppid: 1, pgid: 11, command: 'node server.js --data /var/folders/ab/T/other' },
      { pid: 13, ppid: 1, pgid: 13, command: `node server.js --data /private${folder}` },
      { pid: 12, ppid: 1, pgid: 12, command: `node vitest ${folder}` },
    ];
    expect(processesUsing(rows, folder, 12)).toEqual([10, 13]);
  });
});

describe('vitest temp folder sandbox', () => {
  it('points TMPDIR at a fresh folder and removes it with what is left inside', async () => {
    const before = process.env.TMPDIR;
    const teardown = setup();
    const folder = tmpdir();
    expect(folder).not.toBe(before);
    expect(path.basename(folder)).toMatch(/^sv-/);
    writeFileSync(path.join(folder, 'leftover.txt'), 'left behind');

    await teardown();

    expect(existsSync(folder)).toBe(false);
    expect(process.env.TMPDIR).toBe(before);
  });

  it('stops a child process still running from the folder before removing it', async () => {
    const teardown = setup();
    const folder = tmpdir();
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', folder], {
      stdio: 'ignore',
    });
    const exit = exited(child);
    await new Promise((resolve) => child.once('spawn', resolve));

    await teardown();

    expect(await exit).toBe('SIGTERM');
    expect(existsSync(folder)).toBe(false);
  });
});
