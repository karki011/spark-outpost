import { describe, expect, it } from 'vitest';
import { apiOrigin, targetsApi, withApiToken } from './api-token.ts';

const origin = apiOrigin('127.0.0.1', 51234);
const TOKEN = 'launch-token';

describe('API token header', () => {
  it('matches the API origin for pages, fetches, streams and sockets', () => {
    expect(targetsApi('http://127.0.0.1:51234/', origin)).toBe(true);
    expect(targetsApi('http://127.0.0.1:51234/api/events', origin)).toBe(true);
    expect(targetsApi('ws://127.0.0.1:51234/api/terminals/1/stream', origin)).toBe(true);
  });

  it('does not match other hosts, ports or schemes', () => {
    expect(targetsApi('http://127.0.0.1:51235/api/health', origin)).toBe(false);
    expect(targetsApi('http://localhost:51234/api/health', origin)).toBe(false);
    expect(targetsApi('https://127.0.0.1:51234/api/health', origin)).toBe(false);
    expect(targetsApi('https://fonts.googleapis.com/css2', origin)).toBe(false);
    expect(targetsApi('not a url', origin)).toBe(false);
  });

  it('adds the token only to API requests', () => {
    expect(
      withApiToken({ Accept: '*/*' }, 'http://127.0.0.1:51234/api/health', origin, TOKEN),
    ).toEqual({
      Accept: '*/*',
      'x-spark-token': TOKEN,
    });
    expect(
      withApiToken({ Accept: '*/*' }, 'https://fonts.gstatic.com/a.woff2', origin, TOKEN),
    ).toEqual({
      Accept: '*/*',
    });
  });

  it('never forwards a token the page set itself', () => {
    const forged = { 'X-Spark-Token': 'forged' };
    expect(withApiToken(forged, 'https://example.com/', origin, TOKEN)).toEqual({});
    expect(withApiToken(forged, `${origin}/api/health`, origin, TOKEN)).toEqual({
      'x-spark-token': TOKEN,
    });
  });
});
