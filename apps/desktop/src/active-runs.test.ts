import { describe, expect, it } from 'vitest';
import { fetchActiveRuns } from './active-runs.ts';

const ORIGIN = 'http://127.0.0.1:50002';

function respond(status: number, body: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(body), { status });
}

describe('fetchActiveRuns', () => {
  it('asks the API with the launch token and reads the count', async () => {
    let seen: { url: string; token: string | null } | null = null;
    const fetchImpl: typeof fetch = async (input, init) => {
      seen = { url: String(input), token: new Headers(init?.headers).get('x-spark-token') };
      return new Response(JSON.stringify({ activeRuns: 2 }), { status: 200 });
    };

    expect(await fetchActiveRuns(ORIGIN, 'tok', fetchImpl)).toBe(2);
    expect(seen).toEqual({ url: `${ORIGIN}/api/runs/active`, token: 'tok' });
  });

  it('reports unknown when the API fails or answers something else', async () => {
    expect(await fetchActiveRuns(ORIGIN, 'tok', respond(500, {}))).toBeNull();
    expect(await fetchActiveRuns(ORIGIN, 'tok', respond(200, { activeRuns: -1 }))).toBeNull();
    const failing: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(await fetchActiveRuns(ORIGIN, 'tok', failing)).toBeNull();
  });
});
