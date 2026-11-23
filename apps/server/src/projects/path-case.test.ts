import { posix } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { protectedPath, refusalFor, relativeInside } from './path-policy.ts';

const platform = process.platform;

function on(value: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value });
}

afterEach(() => on(platform));

describe('letter case in protected paths', () => {
  it('protects instruction files and git control in any case on Windows', () => {
    on('win32');
    expect(protectedPath('agents.md')).toBe('instructions');
    expect(protectedPath('docs/Claude.MD')).toBe('instructions');
    expect(protectedPath('.Claude/settings.json')).toBe('instructions');
    expect(protectedPath('.GIT/hooks/pre-commit')).toBe('git_control');
    expect(protectedPath('.git/CONFIG')).toBe('git_control');
    expect(protectedPath('src/agents.ts')).toBeNull();
  });

  it.each(['darwin', 'linux'] as const)(
    'keeps exact case on %s, as Claude ask rules do',
    (value) => {
      on(value);
      expect(protectedPath('agents.md')).toBeNull();
      expect(protectedPath('AGENTS.md')).toBe('instructions');
    },
  );

  it('finds a target inside a project whose path differs only in case on Windows', () => {
    on('win32');
    expect(relativeInside('/c/Work/App', '/c/work/app/.Git/config', posix)).toBe('.Git/config');
    expect(relativeInside('/c/Work/App', '/c/work/other/a.ts', posix)).toBeNull();
    expect(relativeInside('/c/Work/App', '/c/work/app', posix)).toBeNull();
  });

  it('keeps case when deciding inside on macOS and Linux', () => {
    for (const value of ['darwin', 'linux'] as const) {
      on(value);
      expect(relativeInside('/Work/App', '/work/app/a.ts', posix)).toBeNull();
    }
  });

  it('refuses writes inside .git in any case on Windows', () => {
    on('win32');
    expect(refusalFor('.GIT/objects/x', 'write', [])).toBe('inside .git');
    expect(refusalFor('.Git/HEAD', 'write', [])).toBe('inside .git');
    on('linux');
    expect(refusalFor('.GIT/objects/x', 'write', [])).toBeNull();
  });
});
