import { describe, expect, it } from 'vitest';
import {
  secretStorageItem,
  storageSecretParts,
  withoutValue,
  withoutStorageSecrets,
} from './browser-storage.ts';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl';
const OPAQUE = 'a8f3k2m9q7x1z5w4b6n0c3v8l2j7h4g9';

describe('which storage values are kept from agents', () => {
  it.each([
    'sb-abcdefgh-auth-token',
    'firebase:authUser:AIzaSy:[DEFAULT]',
    'CognitoIdentityServiceProvider.client.user.idToken',
    'okta-token-storage',
    '@@auth0spajs@@::client::default::openid',
    'abc-login.windows.net-accesstoken-client--scope',
    'sessionId',
    'csrf',
    'api_key',
    'refresh_token',
  ])('masks the value under %s', (key) => {
    expect(secretStorageItem(key, 'plain')).toBe(true);
  });

  it('masks a value that holds a token under a plain key', () => {
    expect(secretStorageItem('last', JWT)).toBe(true);
    expect(secretStorageItem('cache', `id=${OPAQUE}`)).toBe(true);
    expect(secretStorageItem('state', '{"user":{"accessToken":"x"}}')).toBe(true);
    expect(
      secretStorageItem('persist:root', JSON.stringify({ user: JSON.stringify({ jwt: 'x' }) })),
    ).toBe(true);
  });

  it('shows ordinary values', () => {
    expect(secretStorageItem('theme', 'dark')).toBe(false);
    expect(secretStorageItem('cart', '{"items":2,"currency":"EUR"}')).toBe(false);
    expect(secretStorageItem('slug', 'a-rather-long-article-title-with-only-words')).toBe(false);
    expect(secretStorageItem('lastVisit', '2026-10-20T09:00:00.000Z')).toBe(false);
  });

  it('gives the token parts eval must mask, at least 8 characters long', () => {
    const value = JSON.stringify({ accessToken: JWT, user: { name: 'me', id: 'u_12345678' } });
    const parts = storageSecretParts(value);
    expect(parts).toContain(value);
    expect(parts).toContain(JWT);
    expect(parts).toContain('u_12345678');
    expect(parts).not.toContain('me');
  });

  it('drops a masked value and every cookie value', () => {
    expect(withoutStorageSecrets({ key: 'token', bytes: 9, value: 'abc' })).toEqual({
      key: 'token',
      bytes: 9,
      masked: true,
    });
    expect(withoutStorageSecrets({ key: 'theme', bytes: 9, value: 'dark' })).toEqual({
      key: 'theme',
      bytes: 9,
      value: 'dark',
    });
    expect(withoutValue({ name: 'lang', value: 'en' })).toEqual({ name: 'lang' });
  });
});
