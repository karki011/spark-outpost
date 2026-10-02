import { describe, expect, it } from 'vitest';
import { adoptLoginShellPath, loginShellPath, mergePath, parseShellPath } from './shell-path.ts';

describe('parseShellPath', () => {
  it('reads the PATH between the markers even when the shell prints a banner', () => {
    expect(parseShellPath('Welcome!\n__SPARK_PATH__/a/bin:/usr/bin__SPARK_PATH__')).toBe(
      '/a/bin:/usr/bin',
    );
    expect(parseShellPath('no markers here')).toBeNull();
    expect(parseShellPath('__SPARK_PATH____SPARK_PATH__')).toBeNull();
  });
});

describe('mergePath', () => {
  it('keeps the first occurrence of each folder in order', () => {
    expect(mergePath('/node/bin:/usr/bin', '/usr/bin:/bin', null, '/usr/local/bin')).toBe(
      '/node/bin:/usr/bin:/bin:/usr/local/bin',
    );
  });
});

describe('loginShellPath', () => {
  it('asks an interactive login shell for its PATH', async () => {
    const calls: string[][] = [];
    const value = await loginShellPath('/bin/zsh', async (shell, args) => {
      calls.push([shell, ...args]);
      return '__SPARK_PATH__/Users/me/.local/share/node24/bin:/usr/bin__SPARK_PATH__';
    });
    expect(value).toBe('/Users/me/.local/share/node24/bin:/usr/bin');
    expect(calls[0]?.slice(0, 2)).toEqual(['/bin/zsh', '-ilc']);
  });

  it('gives up quietly when the shell fails', async () => {
    expect(
      await loginShellPath('/bin/zsh', async () => {
        throw new Error('timed out');
      }),
    ).toBeNull();
  });
});

describe('adoptLoginShellPath', () => {
  it('puts the login shell folders first so Finder-launched apps find node-based CLIs', async () => {
    const env: NodeJS.ProcessEnv = { SHELL: '/bin/zsh', PATH: '/usr/bin:/bin' };
    await adoptLoginShellPath(
      env,
      async () => '__SPARK_PATH__/Users/me/node/bin:/usr/bin__SPARK_PATH__',
    );
    expect(env.PATH).toBe('/Users/me/node/bin:/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin');
  });

  it('still adds the Homebrew folders when the shell gives nothing', async () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin' };
    await adoptLoginShellPath(env, async () => '');
    expect(env.PATH).toBe('/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin');
  });
});
