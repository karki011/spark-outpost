import { describe, expect, it } from 'vitest';
import type { Endpoint } from '../codescan/endpoints.ts';
import { fileKind } from './file-kind.ts';

const plain = (path: string) => ({ path, imports: [], endpoints: [] });
const route: Endpoint = { kind: 'route', method: 'GET', path: '/orders', line: 3 };

describe('fileKind', () => {
  it.each([
    ['apps/web/src/tickets/Tickets.tsx', 'ui'],
    ['apps/web/src/theme/theme-cards.css', 'ui'],
    ['apps/web/src/api/client.ts', 'api'],
    ['apps/web/src/tickets/tickets-api.ts', 'api'],
    ['apps/server/src/tickets/sync.ts', 'api'],
    ['apps/server/src/persistence/db.ts', 'data'],
    ['apps/server/migrations/0072_project_map.sql', 'data'],
    ['packages/contracts/src/map.ts', 'data'],
    ['apps/web/src/map/scene.test.ts', 'test'],
    ['tests/browser/project-map.spec.ts', 'test'],
    ['tests/browser/ticket-stub.ts', 'test'],
    ['scripts/check-source.ts', 'config'],
    ['apps/web/vite.config.ts', 'config'],
    ['package.json', 'config'],
    ['cmd/worker/main.go', 'api'],
    ['docs/guide.md', 'other'],
    ['packages/format/src/money.ts', 'other'],
  ])('%s is %s', (path, kind) => {
    expect(fileKind(plain(path))).toBe(kind);
  });

  it('uses routes, imports and server modules when the path says nothing', () => {
    expect(fileKind({ path: 'src/orders.ts', imports: [], endpoints: [route] })).toBe('api');
    expect(fileKind({ path: 'src/models/orders.ts', imports: [], endpoints: [route] })).toBe('api');
    expect(fileKind({ path: 'lib/widget.ts', imports: ['react'], endpoints: [] })).toBe('ui');
    expect(
      fileKind({ path: 'lib/store.ts', imports: ['drizzle-orm/pg-core'], endpoints: [] }),
    ).toBe('data');
    expect(fileKind({ path: 'lib/serve.ts', imports: ['express'], endpoints: [] })).toBe('api');
    expect(fileKind({ path: 'lib/serve.test.ts', imports: ['express'], endpoints: [route] })).toBe(
      'test',
    );
  });
});
