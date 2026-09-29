import { describe, expect, it } from 'vitest';
import type { Queryable } from '../persistence/db.ts';
import { listUserMcp } from './store.ts';

function returning(config: unknown, lastCheck: unknown): Queryable {
  const row = {
    id: '00000000-0000-4000-8000-000000000001',
    source: 'user',
    name: 'docs',
    transport: 'stdio',
    config,
    fingerprint: 'f',
    last_check: lastCheck,
  };
  return { query: async () => ({ rows: [row] }) } as unknown as Queryable;
}

const check = {
  ok: true,
  tools: ['search'],
  error: null,
  checkedAt: '2026-09-01T00:00:00.000Z',
  fingerprint: 'f',
};

describe('listUserMcp', () => {
  it('reads a well-formed config and check', async () => {
    const [server] = await listUserMcp(
      returning({ command: 'npx', args: ['docs'], envNames: ['TOKEN'] }, check),
      'w',
    );
    expect(server?.config).toEqual({
      command: 'npx',
      args: ['docs'],
      url: null,
      envNames: ['TOKEN'],
      headerNames: [],
      secretNames: [],
    });
    expect(server?.check).toEqual(check);
  });

  it('falls back to safe values for malformed config fields and checks', async () => {
    const [server] = await listUserMcp(
      returning({ command: 5, args: 'rm -rf /', envNames: [1], origin: {} }, { ok: 'yes' }),
      'w',
    );
    expect(server?.config).toEqual({
      command: null,
      args: [],
      url: null,
      envNames: [],
      headerNames: [],
      secretNames: [],
    });
    expect(server?.check).toBeNull();
    const [empty] = await listUserMcp(returning(null, null), 'w');
    expect(empty?.config.args).toEqual([]);
  });
});
