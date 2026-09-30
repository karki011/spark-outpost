import { describe, expect, it } from 'vitest';
import type { Endpoint } from '../codescan/endpoints.ts';
import {
  httpFit,
  matchEnv,
  matchGraphql,
  matchHttp,
  matchPackages,
  segments,
  type LinkFile,
  type LinkRepo,
} from './link-match.ts';

function endpoint(
  kind: Endpoint['kind'],
  method: string | null,
  path: string,
  base = false,
): Endpoint {
  return { kind, method, path, line: 1, ...(base ? { base: true } : {}) };
}

function file(path: string, endpoints: Endpoint[], imports: string[] = []): LinkFile {
  return { path, areaId: path.split('/')[1] ?? path, importance: 0.5, endpoints, imports };
}

const backend: LinkRepo = {
  id: 'be',
  packageNames: ['@acme/api', '@acme/types'],
  files: [
    file('src/app.ts', [
      endpoint('mount', null, '/api'),
      endpoint('env', null, 'STRIPE_PUBLIC_KEY'),
    ]),
    file(
      'src/orders.ts',
      [
        endpoint('route', 'GET', '/orders'),
        endpoint('route', 'GET', '/orders/:id'),
        endpoint('route', 'GET', '/orders/latest'),
        endpoint('route', 'POST', '/orders'),
      ],
      ['@acme/types'],
    ),
    file('src/users.ts', [
      endpoint('route', 'GET', '/users/:id'),
      endpoint('route', 'GET', '/teams/:id'),
    ]),
    file('src/schema.ts', [endpoint('gql_field', null, 'Query.orders')]),
  ],
};

const frontend: LinkRepo = {
  id: 'fe',
  packageNames: ['web'],
  files: [
    file(
      'web/orders.ts',
      [
        endpoint('call', 'GET', '/api/orders'),
        endpoint('call', 'GET', '/api/orders/${id}'),
        endpoint('call', 'GET', '/api/orders/latest'),
        endpoint('call', 'POST', '/orders', true),
        endpoint('call', 'DELETE', '/api/orders/1'),
        endpoint('call', 'GET', '/somewhere/else'),
      ],
      ['@acme/types', 'react'],
    ),
    file('web/dynamic.ts', [endpoint('call', 'GET', '/api/${kind}/${id}')]),
    file('web/query.ts', [
      endpoint('gql_op', null, 'Query.orders'),
      endpoint('env', null, 'VITE_STRIPE_PUBLIC_KEY'),
    ]),
  ],
};

describe('cross-repo matching', () => {
  it('normalises path parameters in every common style', () => {
    expect(segments('/Orders/:id/{item}/<int:pk>/[slug]/${x}/v-${n}')).toEqual([
      'orders',
      ':',
      ':',
      ':',
      ':',
      ':',
      ':',
    ]);
  });

  it('scores exact, mounted, base-URL and method-mismatched calls', () => {
    const mounts = [['api']];
    const route = endpoint('route', 'GET', '/orders/:id');
    expect(httpFit(endpoint('call', 'GET', '/orders/7'), route, mounts)?.score).toBe(0.95);
    expect(httpFit(endpoint('call', 'GET', '/api/orders/7'), route, mounts)?.score).toBe(0.9);
    expect(httpFit(endpoint('call', 'GET', '/v9/orders/7'), route, mounts)).toBeNull();
    expect(httpFit(endpoint('call', 'GET', '/v9/orders/7', true), route, mounts)?.score).toBe(0.7);
    expect(httpFit(endpoint('call', 'POST', '/orders/7'), route, mounts)).toBeNull();
  });

  it('links calls to the most specific route and flags real ambiguity for Jev', () => {
    const { links, ambiguous } = matchHttp(frontend, backend);
    const labels = links.map((link) => `${link.fromPath} -> ${link.label} (${link.confidence})`);
    expect(labels).toEqual([
      'web/orders.ts -> GET /api/orders (0.9)',
      'web/orders.ts -> GET /api/orders/:id (0.9)',
      'web/orders.ts -> GET /api/orders/latest (0.9)',
      'web/orders.ts -> POST /orders (0.8)',
      'web/dynamic.ts -> GET /api/orders/:id (0.18)',
      'web/dynamic.ts -> GET /api/users/:id (0.18)',
      'web/dynamic.ts -> GET /api/teams/:id (0.18)',
    ]);
    expect(ambiguous.map((call) => call.options.map((option) => option.label))).toEqual([
      ['GET /api/orders/:id', 'GET /api/users/:id', 'GET /api/teams/:id'],
    ]);
  });

  it('links GraphQL operations, shared internal packages and shared env keys', () => {
    expect(
      matchGraphql(frontend, backend).map((link) => [link.fromPath, link.toPath, link.label]),
    ).toEqual([['web/query.ts', 'src/schema.ts', 'Query.orders']]);
    expect(matchPackages(frontend, backend).map((link) => [link.label, link.confidence])).toEqual([
      ['@acme/types', 0.85],
    ]);
    expect(
      matchEnv(frontend, backend).map((link) => [link.label, link.fromPath, link.toPath]),
    ).toEqual([['STRIPE_PUBLIC_KEY', 'web/query.ts', 'src/app.ts']]);
  });
});
