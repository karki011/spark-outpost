import { describe, expect, it } from 'vitest';
import { parseProviderRoute, providerRouteHash } from './provider-route.ts';

describe('provider route', () => {
  it('round-trips the overview and a provider screen', () => {
    expect(parseProviderRoute(providerRouteHash(null))).toEqual({ providerId: null });
    expect(parseProviderRoute(providerRouteHash('codex'))).toEqual({ providerId: 'codex' });
    expect(providerRouteHash('jev')).toBe('#/settings/providers/jev');
  });

  it('falls back to the overview for unknown providers and ignores other hashes', () => {
    expect(parseProviderRoute('#/settings/providers/nope')).toEqual({ providerId: null });
    expect(parseProviderRoute('#/settings/providers/claude/')).toEqual({ providerId: 'claude' });
    expect(parseProviderRoute('#/settings/providersx')).toBeNull();
    expect(parseProviderRoute('#/docs/connect-a-provider')).toBeNull();
    expect(parseProviderRoute('')).toBeNull();
  });
});
