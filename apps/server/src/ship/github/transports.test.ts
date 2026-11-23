import { describe, expect, it } from 'vitest';
import { apiBaseFor } from '../remote.ts';
import { ghCliRequest, endpointFor } from './transports.ts';

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

describe('ghCliRequest', () => {
  const answering = (stderr: string) =>
    ghCliRequest('/usr/bin/gh', 'github.com', () =>
      Promise.resolve({ code: 1, stdout: '', stderr }),
    );

  it('reads the HTTP status from either way gh prints it', async () => {
    await expect(answering('gh: HTTP 502')('POST', '/graphql')).resolves.toMatchObject({
      status: 502,
    });
    await expect(answering('gh: Not Found (HTTP 404)')('GET', '/repos/a/b')).resolves.toMatchObject(
      { status: 404 },
    );
  });

  it('points to the login only when gh gave no HTTP status', async () => {
    await expect(answering('error connecting to api.github.com')('GET', '/user')).rejects.toThrow(
      /gh auth status/,
    );
  });
});
