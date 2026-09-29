import { describe, expect, it } from 'vitest';
import { childEnvironment, isSecretEnvName } from './environment.ts';

describe('child process environment', () => {
  it('drops every name that mentions a secret, token, password or key', () => {
    const env = childEnvironment({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      MEMORY_SECRETS: '{"jev":"k"}',
      CLIENT_SECRET: 's',
      GH_TOKEN: 't',
      TOKEN_FILE: '/tmp/t',
      PGPASSWORD: 'p',
      PASSWORD_HINT: 'h',
      OPENAI_API_KEY: 'k',
      AWS_ACCESS_KEY_ID: 'id',
      api_key: 'k',
      DATABASE_URL: 'postgres://u:p@h/db',
      TEST_DATABASE_URL: 'postgres://u:p@h/test',
    });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/me' });
  });

  it('keeps git config entries so their count still matches', () => {
    const env = childEnvironment({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.pager',
      GIT_CONFIG_VALUE_0: 'cat',
    });
    expect(env).toEqual({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.pager',
      GIT_CONFIG_VALUE_0: 'cat',
    });
  });

  it('drops the parent agent session but keeps the Claude config folder', () => {
    const env = childEnvironment({
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CONFIG_DIR: '/Users/me/.claude',
      SHELL: '/bin/zsh',
      UNSET: undefined,
    });
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: '/Users/me/.claude', SHELL: '/bin/zsh' });
  });

  it('names secrets by any part of the name', () => {
    expect(isSecretEnvName('MEMORY_SECRETS')).toBe(true);
    expect(isSecretEnvName('SESSION_TOKENS')).toBe(true);
    expect(isSecretEnvName('LANG')).toBe(false);
  });
});
