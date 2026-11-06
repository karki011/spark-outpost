import { describe, expect, it } from 'vitest';
import type { CustomKeyHeader } from '@spark-outpost/contracts';
import { customEndpointEnvironment } from './custom-endpoint.ts';

const KEY = 'gateway-unit-key.0123456789';
const parent = {
  PATH: '/usr/bin:/bin',
  HOME: '/Users/someone',
  ANTHROPIC_API_KEY: 'sk-ant-api03-parent',
  ANTHROPIC_AUTH_TOKEN: 'parent-token',
  ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
  ANTHROPIC_CUSTOM_HEADERS: 'x-org: acme',
  CLAUDE_CODE_OAUTH_TOKEN: 'parent-oauth',
  CLAUDE_CONFIG_DIR: '/Users/someone/.claude',
};

function environment(apiKey: string, keyHeader: CustomKeyHeader) {
  const endpoint = {
    baseUrl: 'https://gateway.example.com/anthropic',
    model: 'big',
    fastModel: '',
    apiKey,
    keyHeader,
  };
  return customEndpointEnvironment(parent, endpoint, '/tmp/custom-config');
}

function credentialNames(env: Record<string, string>): string[] {
  return Object.keys(env)
    .filter((name) =>
      /^(ANTHROPIC_(API_KEY|AUTH_TOKEN|CUSTOM_HEADERS)|CLAUDE_CODE_OAUTH)/.test(name),
    )
    .sort();
}

describe('custom endpoint launch environment', () => {
  it('sends the key as the bearer token by default', () => {
    const env = environment(KEY, 'bearer');
    expect(credentialNames(env)).toEqual(['ANTHROPIC_AUTH_TOKEN']);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(KEY);
    expect(env.ANTHROPIC_BASE_URL).toBe('https://gateway.example.com/anthropic');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/custom-config');
  });

  it('sends the key only as ANTHROPIC_API_KEY for x-api-key', () => {
    const env = environment(KEY, 'x-api-key');
    expect(credentialNames(env)).toEqual(['ANTHROPIC_API_KEY']);
    expect(env.ANTHROPIC_API_KEY).toBe(KEY);
    expect(Object.values(env)).not.toContain('sk-ant-api03-parent');
    expect(Object.values(env)).not.toContain('parent-token');
  });

  it('sends the placeholder bearer token when there is no key, whatever the header', () => {
    for (const keyHeader of ['bearer', 'x-api-key'] as const) {
      const env = environment('', keyHeader);
      expect(credentialNames(env)).toEqual(['ANTHROPIC_AUTH_TOKEN']);
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('spark-outpost-no-key');
    }
  });
});
