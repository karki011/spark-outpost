import { describe, expect, it } from 'vitest';
import { agentDefinitions } from './agents.ts';
import { longContextEnv, shortWindowNote } from './long-context.ts';

const claude = agentDefinitions.claude;
const LONG_ALIASES = {
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5[1m]',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5[1m]',
};

describe('longContextEnv', () => {
  it('points the 1M-card Claude aliases at their [1m] variants', () => {
    expect(longContextEnv(claude, { PATH: '/usr/bin' })).toEqual(LONG_ALIASES);
  });

  it('leaves Z.ai and Codex with their own windows', () => {
    expect(longContextEnv(agentDefinitions.zai, {})).toEqual({});
    expect(longContextEnv(agentDefinitions.codex, {})).toEqual({});
  });

  it('keeps 200K cards and aliases without a card unchanged', () => {
    const env = longContextEnv(claude, {});
    expect(env).not.toHaveProperty('ANTHROPIC_DEFAULT_HAIKU_MODEL');
    expect(env).not.toHaveProperty('ANTHROPIC_DEFAULT_FABLE_MODEL');
  });

  it('respects a model the user already pinned for an alias', () => {
    expect(longContextEnv(claude, { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5' })).toEqual({
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5[1m]',
    });
    expect(
      longContextEnv(
        claude,
        {},
        {
          env: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6' },
          commands: {},
        },
      ),
    ).toEqual({ ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5[1m]' });
  });

  it('treats the Anthropic API base URL as the default endpoint', () => {
    expect(longContextEnv(claude, { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' })).toEqual(
      LONG_ALIASES,
    );
  });

  it('stays out of the way when Claude is routed through another endpoint', () => {
    expect(longContextEnv(claude, { ANTHROPIC_BASE_URL: 'https://gateway.example' })).toEqual({});
    expect(longContextEnv(claude, { CLAUDE_CODE_USE_BEDROCK: '1' })).toEqual({});
    expect(
      longContextEnv(claude, {}, { env: { ANTHROPIC_VERTEX_BASE_URL: 'https://x' }, commands: {} }),
    ).toEqual({});
  });
});

describe('shortWindowNote', () => {
  const opus = { '_claude/model': 'claude-opus-5-5' };

  it('says when a 1M model runs with a smaller window on this account', () => {
    expect(shortWindowNote(opus, 200_000)).toBe(
      'Opus 5.5 is using a 200K context window on this account, not 1M',
    );
  });

  it('stays quiet at the full window, for 200K models and for unknown models', () => {
    expect(shortWindowNote(opus, 1_000_000)).toBeNull();
    expect(shortWindowNote({ '_claude/model': 'claude-haiku-4-5' }, 200_000)).toBeNull();
    expect(shortWindowNote({ '_claude/model': 'mystery' }, 200_000)).toBeNull();
    expect(shortWindowNote(undefined, 200_000)).toBeNull();
  });
});
