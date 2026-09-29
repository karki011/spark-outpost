import { describe, expect, it } from 'vitest';
import type { Queryable } from '../persistence/db.ts';
import { trustFor } from './trust-store.ts';

const PROJECT = '00000000-0000-4000-8000-000000000001';

function returning(snapshot: unknown): Queryable {
  const row = {
    project_id: PROJECT,
    trusted: true,
    fingerprint: 'f',
    snapshot,
    redirects_fingerprint: null,
    decided_at: new Date('2026-09-01T00:00:00Z'),
  };
  return { query: async () => ({ rows: [row] }) } as unknown as Queryable;
}

describe('trustFor', () => {
  it('keeps a well-formed snapshot', async () => {
    const item = { kind: 'hook', key: 'k', label: 'Run lint', fingerprint: 'h' };
    const trust = await trustFor(returning([item]), [PROJECT]);
    expect(trust.get(PROJECT)?.snapshot).toEqual([item]);
  });

  it('treats a malformed snapshot as empty', async () => {
    for (const snapshot of [null, 'x', [{ kind: 'shell', key: 1 }], { items: [] }]) {
      const trust = await trustFor(returning(snapshot), [PROJECT]);
      expect(trust.get(PROJECT)?.snapshot).toEqual([]);
    }
  });
});
