import { describe, expect, it } from 'vitest';
import { agentDefinitions } from './agents.ts';
import { FOREGROUND_COMMAND_ENV, withBackgroundedCommands } from './claude-env.ts';

describe('how long a Claude chat agent waits on a foreground command', () => {
  it('is 30 seconds, after which Claude Code moves the command to the background', () => {
    expect(withBackgroundedCommands(agentDefinitions.claude, { PATH: '/usr/bin' })).toEqual({
      PATH: '/usr/bin',
      BASH_DEFAULT_TIMEOUT_MS: '30000',
      BASH_MAX_TIMEOUT_MS: '30000',
    });
  });

  it('keeps a limit the user set themselves', () => {
    const own = { BASH_MAX_TIMEOUT_MS: '300000' };
    expect(withBackgroundedCommands(agentDefinitions.claude, own)).toBe(own);
  });

  it('leaves Codex alone', () => {
    const env = { PATH: '/usr/bin' };
    expect(withBackgroundedCommands(agentDefinitions.codex, env)).toBe(env);
    expect(FOREGROUND_COMMAND_ENV.BASH_MAX_TIMEOUT_MS).toBe('30000');
  });
});
