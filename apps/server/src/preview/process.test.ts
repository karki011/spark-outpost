import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnInLoginShell } from './process.ts';

const ZSH = '/bin/zsh';
const QUESTION = '[oh-my-zsh] Would you like to update? [Y/n]';
const PROMPTING_RC = `
update_mode=prompt
[[ "$DISABLE_UPDATE_PROMPT" != true ]] || update_mode=auto
[[ "$DISABLE_AUTO_UPDATE" != true ]] || update_mode=disabled
if [[ "$update_mode" != disabled && -t 1 ]]; then
  echo -n "${QUESTION} "
  read -r -k 1 option
fi
export PATH="$HOME/rc-bin:$PATH"
`;

let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'spark-shell-rc-'));
  await writeFile(path.join(home, '.zshrc'), PROMPTING_RC);
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

interface Ran {
  output: string;
  exitCode: number | null;
}

function run(command: string, waitMs: number): Promise<Ran> {
  const spawned = spawnInLoginShell(ZSH)({
    command,
    cwd: home,
    env: { PATH: process.env.PATH ?? '', HOME: home, ZDOTDIR: home, TERM: 'xterm-256color' },
  });
  let output = '';
  spawned.onData((data) => {
    output += data;
  });
  return new Promise((resolve) => {
    const stuck = setTimeout(() => {
      spawned.kill();
      resolve({ output, exitCode: null });
    }, waitMs);
    spawned.onExit(({ exitCode }) => {
      clearTimeout(stuck);
      resolve({ output, exitCode });
    });
  });
}

describe('a command Spark starts in the login shell', () => {
  it('runs although the shell start-up would ask to update', async () => {
    const ran = await run('echo "ran with $PATH"', 8_000);

    expect(ran.exitCode).toBe(0);
    expect(ran.output).not.toContain(QUESTION);
    expect(ran.output).toContain(`ran with ${home}/rc-bin:`);
  }, 15_000);
});
