import { RequestError } from '@agentclientprotocol/sdk/unstable';
import { describe, expect, it, vi } from 'vitest';
import { UsageLimitError } from '../../providers/provider.ts';
import { failureError, toProviderError } from './errors.ts';

const message = (error: unknown) => toProviderError('Fake', error, '').message;
const limited = 'Fake is rate limited. Try again in a minute.';

describe('agent error messages', () => {
  it('recognizes rate limits by code, status, message, or error data', () => {
    expect(message(new RequestError(429, 'Slow down'))).toBe(limited);
    expect(message(Object.assign(new Error('Nope'), { status: 429 }))).toBe(limited);
    expect(message(new Error('API Error: 429 Too Many Requests'))).toBe(limited);
    expect(message(RequestError.internalError({ details: 'rate_limit_error' }))).toBe(limited);
  });

  it('keeps sign-in and generic error messages', () => {
    expect(message(RequestError.authRequired())).toBe(
      "Fake isn't signed in. Open Settings, reconnect Fake, and try again.",
    );
    expect(message(new Error('Boom'))).toBe('Fake reported an error: Boom');
  });

  it('maps rate-limited session failures', () => {
    expect(failureError('Fake', { category: 'rate_limited', title: 'Quota' }).message).toBe(
      limited,
    );
    expect(failureError('Fake', { category: 'provider_error', title: 'Boom' }).message).toBe(
      'Fake stopped with an error: Boom',
    );
  });

  it('marks the Claude adapter limit failures as usage limits', () => {
    const quota = failureError('Fake', {
      category: 'limit',
      title: 'The Claude account has no available quota.',
    });
    expect(quota).toBeInstanceOf(UsageLimitError);
    expect(quota.message).toBe(
      "Fake has reached this account's usage limit. Wait for it to reset or check your plan, then try again.",
    );
    const rate = failureError('Fake', {
      category: 'limit',
      title: 'Claude is temporarily rate limited.',
    });
    expect(rate).toBeInstanceOf(UsageLimitError);
  });

  it('maps the session failure categories codex-acp sends', () => {
    const title = 'exceeded retry limit, last status: 429 Too Many Requests';
    expect(failureError('Fake', { category: 'limit', title }).message).toBe(limited);
    expect(failureError('Fake', { category: 'access', title: 'Unauthorized' }).message).toBe(
      "Fake couldn't sign in (Unauthorized). Open Settings, reconnect Fake, and try again.",
    );
    expect(
      failureError('Fake', { category: 'connection', title: 'Connection to Codex was lost.' })
        .message,
    ).toBe('Fake is not available right now (Connection to Codex was lost.). Try again.');
  });

  it('redacts secrets in agent stderr and error text', () => {
    const key = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv';
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const error = toProviderError(
        'Fake',
        new Error(`bad key ${key}`),
        `auth failed for ${key}\n`,
      );
      const printed = logged.mock.calls.flat().join(' ');
      expect(printed).toContain('[redacted:api_key]');
      expect(printed).not.toContain(key);
      expect(error.message).toBe('Fake reported an error: bad key [redacted:api_key]');
    } finally {
      logged.mockRestore();
    }
    expect(failureError('Fake', { category: 'provider_error', title: key }).message).toBe(
      'Fake stopped with an error: [redacted:api_key]',
    );
  });
});
