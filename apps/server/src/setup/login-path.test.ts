import { describe, expect, it } from 'vitest';
import { loginShellEnv, parseLoginEnv, userLoginShell } from './login-path.ts';

describe('the login shell environment', () => {
  it('reads every exported variable after the marker, whatever the shell printed first', () => {
    const stdout = `Welcome back!\n__SPARK_ENV__PATH=/opt/node/bin:/usr/bin\0NPM_TOKEN=abc=def\0npm_config_userconfig=/Users/me/.npmrc\0MULTI=one\ntwo\0`;
    expect(parseLoginEnv(stdout)).toEqual({
      PATH: '/opt/node/bin:/usr/bin',
      NPM_TOKEN: 'abc=def',
      npm_config_userconfig: '/Users/me/.npmrc',
      MULTI: 'one\ntwo',
    });
  });

  it('leaves out the variables that describe the lookup shell itself', () => {
    expect(
      parseLoginEnv('__SPARK_ENV__PWD=/tmp\0SHLVL=2\0_=/usr/bin/env\0HOME=/Users/me\0'),
    ).toEqual({
      HOME: '/Users/me',
    });
  });

  it('is unknown when the shell fails or prints no marker', async () => {
    expect(parseLoginEnv('nothing here')).toBeNull();
    const failing = loginShellEnv(async () => ({ code: 1, stdout: '', stderr: 'no' }), '/bin/nosh');
    expect(await failing()).toBeNull();
    expect(
      await loginShellEnv(async () => ({ code: 0, stdout: '', stderr: '' }), null)(),
    ).toBeNull();
  });
});

describe('which login shell Spark asks', () => {
  it("uses the user's shell on the Mac and Linux, and none on Windows or when turned off", () => {
    expect(userLoginShell(true, { SHELL: '/bin/bash' }, 'darwin')).toBe('/bin/bash');
    expect(userLoginShell(true, {}, 'linux')).toBe('/bin/zsh');
    expect(userLoginShell(false, { SHELL: '/bin/bash' }, 'darwin')).toBeNull();
    expect(userLoginShell(true, { SHELL: '/usr/bin/bash' }, 'win32')).toBeNull();
  });
});
