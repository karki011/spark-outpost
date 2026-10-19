import { describe, expect, it } from 'vitest';
import { QUERY_VALUE_HIDDEN, redactQuery, secretQueryName } from './browser-network.ts';

const hidden = QUERY_VALUE_HIDDEN;

describe('query values in recorded addresses', () => {
  it.each([
    'token',
    'access_token',
    'id_token',
    'refresh_token',
    'key',
    'api_key',
    'apikey',
    'apiKey',
    'secret',
    'client_secret',
    'code',
    'state',
    'password',
    'pass',
    'pwd',
    'signature',
    'sig',
    'auth',
    'session',
    'sid',
    'jwt',
    'assertion',
    'SAMLResponse',
    'X-Amz-Signature',
    'X-Amz-Credential',
    'X-Amz-Security-Token',
    'ACCESS_TOKEN',
    'sessionId',
    'oauth_token',
  ])('hides the value of %s', (name) => {
    expect(secretQueryName(name)).toBe(true);
    expect(redactQuery(`https://a.example/x?${name}=s3cr3t&offset=10`)).toBe(
      `https://a.example/x?${name}=${hidden}&offset=10`,
    );
  });

  it.each(['offset', 'limit', 'author', 'monkey', 'passage', 'sidebar', 'statement', 'q', 'page'])(
    'keeps %s as it was sent',
    (name) => {
      expect(secretQueryName(name)).toBe(false);
    },
  );

  it('matches encoded names and keeps every other value in its exact encoding', () => {
    expect(
      redactQuery('https://a.example/api/grouped_costs?group%5B%5D=a%20b&access%5Ftoken=xyz&q=1+2'),
    ).toBe(`https://a.example/api/grouped_costs?group%5B%5D=a%20b&access%5Ftoken=${hidden}&q=1+2`);
  });

  it('hides secret values in a fragment such as an OAuth implicit reply', () => {
    expect(redactQuery('https://app.example/cb#access_token=abc&token_type=bearer&scope=x')).toBe(
      `https://app.example/cb#access_token=${hidden}&token_type=${hidden}&scope=x`,
    );
    expect(redactQuery('https://app.example/docs#section-2')).toBe(
      'https://app.example/docs#section-2',
    );
  });

  it('leaves addresses without a query alone, and names without a value', () => {
    expect(redactQuery('https://a.example/x')).toBe('https://a.example/x');
    expect(redactQuery('https://a.example/x?token&debug')).toBe('https://a.example/x?token&debug');
    expect(redactQuery('https://a.example/x?%E0%A4%A=1&code=2')).toBe(
      `https://a.example/x?%E0%A4%A=1&code=${hidden}`,
    );
  });
});
