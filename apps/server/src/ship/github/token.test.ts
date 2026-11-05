import { describe, expect, it } from 'vitest';
import { parseExpiry, parseScopes } from './token.ts';

describe('token headers', () => {
  it('reads the expiry GitHub sends for fine-grained tokens', () => {
    expect(parseExpiry('2026-12-31 00:00:00 UTC')).toBe('2026-12-31T00:00:00.000Z');
    expect(parseExpiry('2026-06-30 00:00:00 -0700')).toBe('2026-06-30T07:00:00.000Z');
    expect(parseExpiry(null)).toBeNull();
    expect(parseExpiry('soon')).toBeNull();
  });

  it('splits classic token scopes', () => {
    expect(parseScopes('repo, read:org')).toEqual(['repo', 'read:org']);
    expect(parseScopes(null)).toEqual([]);
  });
});
