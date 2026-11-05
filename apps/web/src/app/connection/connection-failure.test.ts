import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { describeFailure, isConnectionLoss, retryDelayMs } from './connection-failure.ts';

describe('retryDelayMs', () => {
  it('doubles from one second and caps at ten seconds', () => {
    const schedule = [0, 1, 2, 3, 4, 5, 12].map(retryDelayMs);
    expect(schedule).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000]);
  });
});

describe('describeFailure', () => {
  it('treats gateway errors and network failures as a restarting server', () => {
    for (const status of [502, 503, 504]) {
      expect(describeFailure(new ApiError(status, 'down', '/api/setup'))).toEqual({
        kind: 'unreachable',
        status,
        url: '/api/setup',
      });
    }
    expect(describeFailure(new ApiError(0, 'unreachable', '/api/setup'))).toEqual({
      kind: 'unreachable',
      status: null,
      url: '/api/setup',
    });
  });

  it('treats other server errors and unexpected failures as a server problem', () => {
    expect(describeFailure(new ApiError(500, 'boom', '/api/setup'))).toMatchObject({
      kind: 'server',
      status: 500,
    });
    expect(describeFailure(new Error('bad payload'))).toEqual({
      kind: 'server',
      status: null,
      url: null,
    });
  });
});

describe('isConnectionLoss', () => {
  it('only flags failures that mean the server went away', () => {
    expect(isConnectionLoss(new ApiError(503, 'restarting'))).toBe(true);
    expect(isConnectionLoss(new ApiError(0, 'unreachable'))).toBe(true);
    expect(isConnectionLoss(new ApiError(500, 'boom'))).toBe(false);
    expect(isConnectionLoss(new ApiError(404, 'missing'))).toBe(false);
    expect(isConnectionLoss(new TypeError('parse'))).toBe(false);
  });
});
