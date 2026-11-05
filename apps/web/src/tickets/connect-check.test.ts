import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client.ts';
import { checkFailure } from './connect-check.ts';

describe('checkFailure', () => {
  it('points a rejected key at the secret field with a sad blob', () => {
    const error = new ApiError(400, 'Jira rejected this key (401).');
    expect(checkFailure('jira', error)).toEqual({
      message: 'Jira rejected this key (401).',
      field: 'apiToken',
      mood: 'sad',
    });
    expect(checkFailure('linear', error).field).toBe('apiKey');
  });

  it('points an unreachable Jira at the site address with a puzzled blob', () => {
    const error = new ApiError(502, "Couldn't reach Jira.");
    expect(checkFailure('jira', error)).toMatchObject({ field: 'siteUrl', mood: 'puzzled' });
    expect(checkFailure('linear', error)).toMatchObject({ field: null, mood: 'puzzled' });
  });

  it('keeps network and unknown failures neutral', () => {
    expect(checkFailure('jira', new ApiError(0, 'The server could not be reached.'))).toEqual({
      message: 'The server could not be reached.',
      field: null,
      mood: 'neutral',
    });
    expect(checkFailure('linear', new TypeError('bad'))).toMatchObject({ mood: 'neutral' });
  });
});
