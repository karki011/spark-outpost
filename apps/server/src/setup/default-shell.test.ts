import { describe, expect, it } from 'vitest';
import { defaultShell } from './default-shell.ts';

describe('the shell Spark starts for terminal tabs and previews', () => {
  it("uses the user's shell on the Mac and Linux", () => {
    expect(defaultShell({ SHELL: '/bin/bash' }, 'darwin')).toBe('/bin/bash');
    expect(defaultShell({}, 'linux')).toBe('/bin/zsh');
  });

  it('uses Git Bash on Windows, so the approval gate can read what runs there', () => {
    const env = {
      SHELL: '/usr/bin/bash',
      ProgramFiles: 'C:\\Program Files',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    };
    const userInstall = 'C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe';
    expect(defaultShell(env, 'win32', (file) => file === userInstall)).toBe(userInstall);
    expect(defaultShell(env, 'win32', () => true)).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
  });

  it('prefers the Git Bash path Claude is told to use', () => {
    const env = { CLAUDE_CODE_GIT_BASH_PATH: 'D:\\Tools\\Git\\bin\\bash.exe' };
    expect(defaultShell(env, 'win32', () => true)).toBe('D:\\Tools\\Git\\bin\\bash.exe');
  });

  it('names the usual Git Bash path when none is found, never a WSL bash', () => {
    expect(defaultShell({}, 'win32', () => false)).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
  });
});
