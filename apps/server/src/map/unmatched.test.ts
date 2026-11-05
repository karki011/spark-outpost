import { describe, expect, it } from 'vitest';
import type { Endpoint } from '../codescan/endpoints.ts';
import type { LinkFile } from './link-match.ts';
import { unmatchedEndpoints, type UnmatchedRepo } from './unmatched.ts';

const WEB = '00000000-0000-4000-8000-000000000001';
const API = '00000000-0000-4000-8000-000000000002';

function file(path: string, endpoints: Endpoint[], importance = 0.5): LinkFile {
  return { path, areaId: 'a', importance, endpoints, imports: [] };
}

const route = (method: string, path: string, line: number): Endpoint => ({
  kind: 'route',
  method,
  path,
  line,
});
const call = (method: string | null, path: string, line: number): Endpoint => ({
  kind: 'call',
  method,
  path,
  line,
});

const web: UnmatchedRepo = {
  projectId: WEB,
  repo: {
    id: 'web',
    packageNames: [],
    files: [
      file('src/orders.ts', [call('GET', '/api/orders', 3), call('POST', '/v1/charges', 9)]),
      file('src/self.ts', [call('GET', '/local/ping', 2)]),
      file('src/local.ts', [route('GET', '/local/ping', 5)]),
      file('src/orders.test.ts', [call('GET', '/api/missing', 1)]),
    ],
  },
};

const api: UnmatchedRepo = {
  projectId: API,
  repo: {
    id: 'api',
    packageNames: [],
    files: [
      file(
        'routes/orders.ts',
        [route('GET', '/api/orders', 4), route('DELETE', '/api/orders/:id', 8)],
        0.9,
      ),
      file('routes/health.ts', [route('GET', '/health', 1), route('GET', '/:page', 2)], 0.1),
    ],
  },
};

describe('unmatchedEndpoints', () => {
  it('lists routes nothing calls and calls that reach no route, using stored links and same-repo matches', () => {
    const result = unmatchedEndpoints(
      [web, api],
      [
        {
          fromRepo: 'web',
          toRepo: 'api',
          fromPath: 'src/orders.ts',
          toPath: 'routes/orders.ts',
          fromLine: 3,
          toLine: 4,
        },
      ],
    );
    expect(result.routes.map((entry) => `${entry.method} ${entry.path} ${entry.file}`)).toEqual([
      'DELETE /api/orders/:id routes/orders.ts',
      'GET /health routes/health.ts',
    ]);
    expect(result.routes[0]).toMatchObject({ projectId: API, line: 8, confirmedBy: null });
    expect(result.calls.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      'POST /v1/charges',
    ]);
    expect(result).toMatchObject({ routeTotal: 2, callTotal: 1 });
  });

  it('treats every call and route as unmatched when no links exist', () => {
    const result = unmatchedEndpoints([web, api], []);
    expect(result.calls.map((entry) => entry.path)).toEqual(['/api/orders', '/v1/charges']);
    expect(result.routeTotal).toBe(3);
  });
});
