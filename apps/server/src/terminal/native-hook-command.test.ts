import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultShell } from '../setup/default-shell.ts';
import { claudeGitBashEnv, nativeHookCommand } from './native-hook-command.ts';

const exec = promisify(execFile);

const PACKAGED = {
  execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\Spark Outpost\\Spark Outpost.exe',
  script:
    'C:\\Users\\me\\AppData\\Roaming\\Spark Outpost\\main\\terminal-sessions\\s1\\observe.mjs',
  credentials:
    'C:\\Users\\me\\AppData\\Roaming\\Spark Outpost\\main\\terminal-sessions\\s1\\observer.json',
};

describe('the command that runs a Terminal session hook', () => {
  it('keeps the macOS command as it was', () => {
    for (const provider of ['claude', 'codex'] as const)
      expect(
        nativeHookCommand({
          provider,
          platform: 'darwin',
          execPath: '/Applications/Spark Outpost.app/Contents/MacOS/Spark Outpost',
          script: "/Users/me/data/it's/observe.mjs",
          credentials: '/Users/me/data/observer.json',
        }),
      ).toBe(
        "'/usr/bin/env' 'ELECTRON_RUN_AS_NODE=1' '/Applications/Spark Outpost.app/Contents/MacOS/Spark Outpost' '/Users/me/data/it'\\''s/observe.mjs' '/Users/me/data/observer.json'",
      );
  });

  it('writes bash for Claude on Windows, which runs hooks through Git Bash', () => {
    expect(nativeHookCommand({ provider: 'claude', platform: 'win32', ...PACKAGED })).toBe(
      "ELECTRON_RUN_AS_NODE=1 'C:/Users/me/AppData/Local/Programs/Spark Outpost/Spark Outpost.exe' 'C:/Users/me/AppData/Roaming/Spark Outpost/main/terminal-sessions/s1/observe.mjs' 'C:/Users/me/AppData/Roaming/Spark Outpost/main/terminal-sessions/s1/observer.json'",
    );
  });

  it('writes a cmd line for Codex on Windows, which runs hooks through cmd /C', () => {
    expect(nativeHookCommand({ provider: 'codex', platform: 'win32', ...PACKAGED })).toBe(
      'set "ELECTRON_RUN_AS_NODE=1" && "C:\\Users\\me\\AppData\\Local\\Programs\\Spark Outpost\\Spark Outpost.exe" "C:\\Users\\me\\AppData\\Roaming\\Spark Outpost\\main\\terminal-sessions\\s1\\observe.mjs" "C:\\Users\\me\\AppData\\Roaming\\Spark Outpost\\main\\terminal-sessions\\s1\\observer.json"',
    );
  });

  it('points Claude at the Git Bash Spark found on Windows unless one is already set', () => {
    const bash = 'C:\\Program Files\\Git\\bin\\bash.exe';
    const env = { ProgramFiles: 'C:\\Program Files' };
    const exists = (file: string) => file === bash;
    expect(claudeGitBashEnv(env, 'win32', exists)).toEqual({ CLAUDE_CODE_GIT_BASH_PATH: bash });
    expect(
      claudeGitBashEnv({ ...env, CLAUDE_CODE_GIT_BASH_PATH: 'D:\\git\\bash.exe' }, 'win32', exists),
    ).toEqual({});
    expect(claudeGitBashEnv(env, 'win32', () => false)).toEqual({});
    expect(claudeGitBashEnv(env, 'darwin', exists)).toEqual({});
  });
});

describe.skipIf(process.platform !== 'win32')('hook commands on a real Windows PC', () => {
  let folder: string;
  const prepare = () => {
    folder = mkdtempSync(path.join(tmpdir(), 'spark hook-'));
    const script = path.join(folder, 'observe.mjs');
    writeFileSync(
      script,
      'process.stdout.write("hook:" + JSON.stringify([process.argv.slice(2), process.env.ELECTRON_RUN_AS_NODE]))',
    );
    return { execPath: process.execPath, script, credentials: path.join(folder, 'observer.json') };
  };
  const expected = (paths: { credentials: string }) =>
    `hook:${JSON.stringify([[paths.credentials.replaceAll('\\', '/')], '1'])}`;

  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it('runs Claude’s command in Git Bash', async () => {
    const paths = prepare();
    const command = nativeHookCommand({ provider: 'claude', platform: 'win32', ...paths });
    const { stdout } = await exec(defaultShell(), ['-c', command], { encoding: 'utf8' });
    expect(stdout).toBe(expected(paths));
  });

  it('runs Codex’s command through cmd /C as Codex does', async () => {
    const paths = prepare();
    const command = nativeHookCommand({ provider: 'codex', platform: 'win32', ...paths });
    const { stdout } = await exec(process.env.ComSpec ?? 'cmd.exe', ['/C', `"${command}"`], {
      encoding: 'utf8',
      windowsVerbatimArguments: true,
    });
    expect(stdout).toBe(`hook:${JSON.stringify([[paths.credentials], '1'])}`);
  });
});
