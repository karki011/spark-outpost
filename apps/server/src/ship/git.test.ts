import { describe, expect, it } from 'vitest';
import type { CommandResult, RunCommand } from '../setup/command.ts';
import {
  GitInstallerError,
  gitStatus,
  openGitInstaller,
  parseGitVersion,
  parseStatus,
} from './git.ts';

describe('git status parsing', () => {
  it('maps porcelain codes and strips the project prefix', () => {
    const output = [
      ' M app/a.ts',
      '?? app/new.ts',
      ' D app/gone.ts',
      'A  app/staged.ts',
      ' M other/x.ts',
      '',
    ].join('\0');
    expect(parseStatus(output, 'app/')).toEqual([
      { path: 'a.ts', change: 'modified' },
      { path: 'gone.ts', change: 'deleted' },
      { path: 'new.ts', change: 'added' },
      { path: 'staged.ts', change: 'added' },
    ]);
  });
});

function fakeRun(results: Record<string, CommandResult>) {
  const calls: string[] = [];
  const run: RunCommand = async (file, args) => {
    const command = [file, ...args].join(' ');
    calls.push(command);
    return results[command] ?? { code: 127, stdout: '', stderr: `${file}: not found` };
  };
  return { run, calls };
}

const GIT_FOUND = {
  'git --version': { code: 0, stdout: 'git version 2.39.5 (Apple Git-154)\n', stderr: '' },
};

describe('git status', () => {
  it('reads the version from git --version', () => {
    expect(parseGitVersion('git version 2.47.1\n')).toBe('2.47.1');
    expect(parseGitVersion('git version 2.39.5 (Apple Git-154)')).toBe('2.39.5');
    expect(parseGitVersion('xcrun: error: invalid active developer path')).toBeNull();
  });

  it('reports an installed git with its version', async () => {
    const { run } = fakeRun(GIT_FOUND);
    expect(await gitStatus(run, 'darwin')).toEqual({
      installed: true,
      version: '2.39.5',
      canInstall: true,
    });
  });

  it('reports a missing git and offers the installer only on macOS', async () => {
    const { run } = fakeRun({});
    expect(await gitStatus(run, 'darwin')).toEqual({
      installed: false,
      version: null,
      canInstall: true,
    });
    expect((await gitStatus(run, 'linux')).canInstall).toBe(false);
  });
});

describe('opening the git installer', () => {
  it('does nothing when git is already installed', async () => {
    const { run, calls } = fakeRun(GIT_FOUND);
    expect((await openGitInstaller(run, 'darwin')).installed).toBe(true);
    expect(calls).toEqual(['git --version']);
  });

  it('opens the command line tools installer on macOS', async () => {
    const { run, calls } = fakeRun({
      'xcode-select --install': { code: 0, stdout: '', stderr: '' },
    });
    expect((await openGitInstaller(run, 'darwin')).installed).toBe(false);
    expect(calls).toEqual(['git --version', 'xcode-select --install']);
  });

  it('explains what to run when the installer cannot open', async () => {
    const { run } = fakeRun({});
    await expect(openGitInstaller(run, 'darwin')).rejects.toThrow(
      'Run xcode-select --install in Terminal instead.',
    );
    await expect(openGitInstaller(run, 'linux')).rejects.toBeInstanceOf(GitInstallerError);
  });
});
