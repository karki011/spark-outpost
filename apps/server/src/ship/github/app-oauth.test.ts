import { describe, expect, it } from 'vitest';
import { pollDeviceToken, refreshTokens, requestDeviceCode } from './app-oauth.ts';

const APP = { clientId: 'Iv23liExample', slug: 'spark', loginUrl: 'https://github.com' };
const NOW = Date.parse('2026-10-04T10:00:00Z');

function answering(body: unknown, status = 200) {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const code = {
  device_code: 'device-code-0001',
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
};

describe('asking GitHub for a device code', () => {
  it('sends only the client ID and reads the code', async () => {
    const { fetchImpl, calls } = answering(code);
    const result = await requestDeviceCode(APP, fetchImpl, NOW);
    expect(calls).toEqual([
      { url: 'https://github.com/login/device/code', body: 'client_id=Iv23liExample' },
    ]);
    expect(result).toMatchObject({
      userCode: 'WDJB-MJHT',
      intervalSeconds: 5,
      expiresAt: NOW + 900_000,
    });
  });

  it.each([
    'https://github.com.evil.example/login/device',
    'http://github.com/login/device',
    'javascript:alert(1)',
  ])('refuses a verification address that is not on github.com: %s', async (uri) => {
    const { fetchImpl } = answering({ ...code, verification_uri: uri });
    await expect(requestDeviceCode(APP, fetchImpl, NOW)).rejects.toThrow(/unexpected answer/);
  });

  it('explains a disabled device flow and a busy GitHub', async () => {
    await expect(
      requestDeviceCode(APP, answering({ error: 'device_flow_disabled' }).fetchImpl, NOW),
    ).rejects.toThrow(/Enable Device Flow/);
    await expect(requestDeviceCode(APP, answering({}, 429).fetchImpl, NOW)).rejects.toThrow(/busy/);
  });
});

describe('polling for the token', () => {
  it.each([
    [{ error: 'authorization_pending' }, { kind: 'pending' }],
    [
      { error: 'slow_down', interval: 10 },
      { kind: 'slow_down', intervalSeconds: 10 },
    ],
    [{ error: 'slow_down' }, { kind: 'slow_down', intervalSeconds: null }],
    [{ error: 'expired_token' }, { kind: 'expired' }],
    [{ error: 'access_denied' }, { kind: 'denied' }],
  ])('reads %o', async (body, expected) => {
    const { fetchImpl } = answering(body);
    expect(await pollDeviceToken(APP, fetchImpl, 'device-code-0001', NOW)).toEqual(expected);
  });

  it('turns the answer into tokens with expiry times and never sends a secret', async () => {
    const { fetchImpl, calls } = answering({
      access_token: 'ghu_exampleAccessToken',
      expires_in: 28_800,
      refresh_token: 'ghr_exampleRefreshToken',
      refresh_token_expires_in: 15_897_600,
    });
    const answer = await pollDeviceToken(APP, fetchImpl, 'device-code-0001', NOW);
    expect(answer).toEqual({
      kind: 'tokens',
      tokens: {
        accessToken: 'ghu_exampleAccessToken',
        accessExpiresAt: '2026-10-04T18:00:00.000Z',
        refreshToken: 'ghr_exampleRefreshToken',
        refreshExpiresAt: '2027-04-06T10:00:00.000Z',
      },
    });
    expect(calls[0]!.body).not.toContain('client_secret');
  });

  it('accepts an app whose tokens do not expire', async () => {
    const { fetchImpl } = answering({ access_token: 'ghu_exampleAccessToken' });
    expect(await pollDeviceToken(APP, fetchImpl, 'device-code-0001', NOW)).toMatchObject({
      tokens: { accessExpiresAt: null, refreshToken: null },
    });
  });
});

describe('refreshing', () => {
  it('reports a refused refresh token and refuses a malformed answer', async () => {
    const refused = answering({ error: 'bad_refresh_token' });
    expect(await refreshTokens(APP, refused.fetchImpl, 'ghr_old', NOW)).toEqual({
      kind: 'rejected',
    });
    expect(refused.calls[0]!.body).toBe(
      'client_id=Iv23liExample&grant_type=refresh_token&refresh_token=ghr_old',
    );
    await expect(refreshTokens(APP, answering({}).fetchImpl, 'ghr_old', NOW)).rejects.toThrow(
      /unexpected answer/,
    );
  });
});
