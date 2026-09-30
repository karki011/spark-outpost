import { describe, expect, it } from 'vitest';
import { baseName, fileKind, folderOf, shortName } from './file-kind.ts';

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
  ])('%s is %s', (path, kind) => {
    expect(fileKind(path)).toBe(kind);
  });

  it('splits names and folders', () => {
    expect(baseName('a/b/c.tsx')).toBe('c.tsx');
    expect(shortName('a/b/c.tsx')).toBe('c');
    expect(folderOf('a/b/c.tsx')).toBe('a/b/');
    expect(folderOf('c.tsx')).toBe('');
  });
});
