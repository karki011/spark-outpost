import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDb, isTransientConnectError } from './db.ts';

const coded = (code: string, message = 'failed') => Object.assign(new Error(message), { code });

afterEach(() => vi.restoreAllMocks());

describe('isTransientConnectError', () => {
  it('treats a full server and a refused or dropped connection as transient', () => {
    expect(isTransientConnectError(coded('53300', 'sorry, too many clients already'))).toBe(true);
    expect(isTransientConnectError(coded('57P03'))).toBe(true);
    expect(isTransientConnectError(coded('ECONNREFUSED'))).toBe(true);
    expect(isTransientConnectError(new Error('timeout exceeded when trying to connect'))).toBe(
      true,
    );
  });

  it('does not retry a query or authentication error', () => {
    expect(isTransientConnectError(coded('42P01', 'relation does not exist'))).toBe(false);
    expect(isTransientConnectError(coded('28P01', 'password authentication failed'))).toBe(false);
    expect(isTransientConnectError('53300')).toBe(false);
  });
});

describe('createDb', () => {
  it('retries a refused connection with backoff, then gives up', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = createDb('postgres://nobody@127.0.0.1:1/none', { connectTries: 3, retryBaseMs: 1 });
    await expect(db.query('SELECT 1')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    expect(warn).toHaveBeenCalledTimes(2);
    await db.end();
  });
});
