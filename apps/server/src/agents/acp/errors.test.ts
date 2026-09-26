import { RequestError } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
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
});
