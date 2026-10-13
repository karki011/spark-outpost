import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PtyProcess } from '../pty.ts';
import { controlPty } from './control-pty.ts';
import { chooseTmux, killTmuxServer, type TmuxHost } from './tmux-host.ts';

const built = resolve(
  import.meta.dirname,
  '../../../../..',
  '.local/tmux',
  process.arch,
  'bin/tmux',
);
const bin = process.env.SPARK_TMUX_BIN || (existsSync(built) ? built : null);

const LIGHT = { foreground: '#241a13', background: '#faf2eb' };
const DARK = { foreground: '#E7EAEE', background: '#0e1215' };
const VIEWER_BACKGROUND = '\x1b]11;rgb:0101/0202/0303\x1b\\';
const VIEWER_DEVICE = '\x1b[?62;4c';
const READ_REPLIES = `printf 'reply=%s.' "$(cat | od -An -tx1 | tr -d ' \\n')"`;
const ASK_ON_EACH_LINE = `while IFS= read -r line; do stty raw -echo min 0 time 5; printf '\\033]11;?\\007'; reply="$(cat | od -An -tx1 | tr -d ' \\n')"; stty sane; printf 'reply=%s.' "$reply"; done`;

const hex = (text: string) => Buffer.from(text, 'latin1').toString('hex');

async function until(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (check()) return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

describe.skipIf(!bin)('Terminal colours under a real tmux', () => {
  let directory: string;
  let host: TmuxHost;

  const start = (script: string, adopt = false) => {
    const pty: PtyProcess = controlPty(host, {
      sessionId: 'c1',
      adopt,
      cols: 80,
      rows: 24,
      cwd: directory,
      command: '/bin/sh',
      args: ['-c', script],
      env: { PATH: '/usr/bin:/bin' },
      ...(adopt ? {} : { colors: LIGHT }),
    });
    let output = '';
    pty.onData((data) => {
      output += data;
      if (data.includes('\x1b]11;?')) pty.write(VIEWER_BACKGROUND);
      if (data.includes('\x1b[c')) pty.write(VIEWER_DEVICE);
    });
    const replies = () => [...output.matchAll(/reply=([0-9a-f]*)\./g)].map((match) => match[1]);
    return { pty, output: () => output, replies };
  };

  beforeEach(() => {
    directory = mkdtempSync(join(os.tmpdir(), 'sptc-'));
    const choice = chooseTmux({ ...process.env, SPARK_TMUX_BIN: bin! }, directory, null);
    if (!choice.host) throw new Error(choice.reason);
    host = choice.host;
  });

  afterEach(() => {
    killTmuxServer(host);
    rmSync(directory, { recursive: true, force: true });
  });

  it('answers a colour query once, with the colours the session started with', async () => {
    const run = start(
      `stty raw -echo min 0 time 5; printf '\\033]10;?\\033\\\\\\033]11;?\\007\\033[c'; ${READ_REPLIES}; sleep 30`,
    );
    await until(() => run.replies().length === 1, 'the replies');
    expect(run.replies()[0]).toBe(
      hex('\x1b]10;rgb:2424/1a1a/1313\x1b\\\x1b]11;rgb:fafa/f2f2/ebeb\x07\x1b[?1;2c'),
    );
    expect(run.output()).not.toContain('\x1b]11;?');
    expect(run.output()).not.toContain('\x1b[c');
    run.pty.kill?.();
  });

  it('tells a program that follows the colour scheme when the theme changes', async () => {
    const run = start(
      `stty raw -echo min 0 time 20; printf '\\033[?2031hready'; ${READ_REPLIES}; stty time 5; printf '\\033]11;?\\007'; ${READ_REPLIES}; sleep 30`,
    );
    await until(() => run.output().includes('ready'), 'the program');
    run.pty.colors?.(DARK);
    await until(() => run.replies().length === 2, 'the replies');
    expect(run.replies()).toEqual([hex('\x1b[?997;1n'), hex('\x1b]11;rgb:0e0e/1212/1515\x07')]);
    run.pty.kill?.();
  });

  it('keeps the colours for an adopted session and takes new ones', async () => {
    const first = start(ASK_ON_EACH_LINE);
    first.pty.write('\r');
    await until(() => first.replies().length === 1, 'the first reply');
    first.pty.detach?.();
    const again = start('unused', true);
    await until(() => again.replies().length === 1, 'the adopted screen');
    again.pty.write('\r');
    await until(() => again.replies().length === 2, 'the reply after adoption');
    again.pty.colors?.(DARK);
    again.pty.write('\r');
    await until(() => again.replies().length === 3, 'the reply after the theme change');
    expect(again.replies()).toEqual([
      hex('\x1b]11;rgb:fafa/f2f2/ebeb\x07'),
      hex('\x1b]11;rgb:fafa/f2f2/ebeb\x07'),
      hex('\x1b]11;rgb:0e0e/1212/1515\x07'),
    ]);
    again.pty.kill?.();
  });
});
