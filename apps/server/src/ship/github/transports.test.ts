import { describe, expect, it } from 'vitest';
import { apiBaseFor } from '../remote.ts';
import { endpointFor } from './transports.ts';

describe('endpointFor', () => {
  it('keeps REST and GraphQL under the API base on github.com', () => {
    const base = apiBaseFor('github.com');
    expect(endpointFor(base, '/user')).toBe('https://api.github.com/user');
    expect(endpointFor(base, '/graphql')).toBe('https://api.github.com/graphql');
  });

  it('sends GraphQL to /api/graphql on GitHub Enterprise Server', () => {
    const base = apiBaseFor('git.example.com');
    expect(endpointFor(base, '/user')).toBe('https://git.example.com/api/v3/user');
    expect(endpointFor(base, '/graphql')).toBe('https://git.example.com/api/graphql');
  });
});
