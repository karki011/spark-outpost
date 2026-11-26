import { describe, expect, it } from 'vitest';
import {
  fragmentValue,
  parseSparkAddress,
  remoteNeedsYou,
  reachOfHostname,
  remoteSparkBridgeFromHostSchema,
  remoteSparkBridgeToHostSchema,
  remoteSparkPartition,
  remoteSparkWindowTitle,
  sparkPairingEntry,
} from './remote-sparks.ts';

const OWN = 'laptop.tail1234.ts.net';
const ID = '3f1c2a4e-9b7d-4c1e-8a2f-5d6e7f8a9b0c';

describe('parseSparkAddress', () => {
  it('accepts a Serve address with or without the scheme', () => {
    const expected = {
      ok: true,
      hostname: 'studio.tail1234.ts.net',
      reach: 'tailscale',
      code: null,
    };
    expect(parseSparkAddress('https://studio.tail1234.ts.net', OWN)).toEqual(expected);
    expect(parseSparkAddress('  Studio.Tail1234.ts.net/  ', OWN)).toEqual(expected);
  });

  it('reads the code from a pairing link', () => {
    expect(parseSparkAddress('https://studio.tail1234.ts.net/#code=AB12-CD34-EF56', OWN)).toEqual({
      ok: true,
      hostname: 'studio.tail1234.ts.net',
      reach: 'tailscale',
      code: 'AB12-CD34-EF56',
    });
  });

  it('ignores a code that is not a pairing code', () => {
    const parsed = parseSparkAddress('https://studio.tail1234.ts.net/#code=<script>', OWN);
    expect(parsed).toMatchObject({ ok: true, code: null });
  });

  it.each([
    ['', 'empty'],
    ['http://studio.tail1234.ts.net', 'scheme'],
    ['ftp://studio.tail1234.ts.net', 'scheme'],
    ['https://studio.tail1234.ts.net:8443', 'shape'],
    ['https://studio.tail1234.ts.net/chats', 'shape'],
    ['https://user@studio.tail1234.ts.net', 'shape'],
    ['https://user:pass@studio.tail1234.ts.net', 'shape'],
    ['https://studio.tail1234.ts.net/?next=1', 'shape'],
    ['https://100.64.0.1', 'host'],
    ['https://localhost', 'host'],
    ['https://laptop.tail1234.ts.net', 'own'],
    ['LAPTOP.tail1234.ts.net', 'own'],
  ])('refuses %s as %s', (address, problem) => {
    expect(parseSparkAddress(address, OWN)).toEqual({ ok: false, problem });
  });

  it('accepts any reachable address when this Mac has none of its own', () => {
    expect(parseSparkAddress('laptop.tail1234.ts.net', null)).toMatchObject({ ok: true });
  });
});

describe('reachOfHostname', () => {
  it('names a Serve hostname Tailscale and any other hostname a custom domain', () => {
    expect(reachOfHostname('studio.tail1234.ts.net')).toBe('tailscale');
    expect(reachOfHostname('STUDIO.tail1234.TS.NET')).toBe('tailscale');
    expect(reachOfHostname('spark.example.com')).toBe('custom');
    expect(reachOfHostname('ts.net.example.com')).toBe('custom');
  });

  it('accepts a custom domain as an address, with its code', () => {
    expect(parseSparkAddress('https://spark.example.com/#code=AB12', OWN)).toEqual({
      ok: true,
      hostname: 'spark.example.com',
      reach: 'custom',
      code: 'AB12',
    });
  });
});

describe('sparkPairingEntry', () => {
  it('carries the code, this Mac’s name and the kind in the fragment', () => {
    const entry = sparkPairingEntry('studio.tail1234.ts.net', 'Ann’s MacBook & co', 'AB12');
    const [address, hash] = entry.split('#');
    expect(address).toBe('https://studio.tail1234.ts.net/');
    expect(fragmentValue(hash!, 'code')).toBe('AB12');
    expect(fragmentValue(hash!, 'name')).toBe('Ann’s MacBook & co');
    expect(fragmentValue(hash!, 'kind')).toBe('spark');
    expect(parseSparkAddress(entry, OWN)).toMatchObject({ ok: true, code: 'AB12' });
  });

  it('leaves the code out when there is none and bounds the name', () => {
    const hash = sparkPairingEntry('studio.tail1234.ts.net', 'x'.repeat(200), null).split('#')[1]!;
    expect(fragmentValue(hash, 'code')).toBeNull();
    expect(fragmentValue(hash, 'name')).toHaveLength(60);
  });
});

describe('window naming', () => {
  it('builds the partition and the title from saved values', () => {
    expect(remoteSparkPartition(ID)).toBe(`spark-remote-${ID}`);
    expect(remoteSparkWindowTitle('Studio Mac', 'studio.tail1234.ts.net')).toBe(
      'Remote control · Studio Mac · studio.tail1234.ts.net',
    );
  });
});

describe('bridge messages', () => {
  it('accepts an open with or without a saved cookie', () => {
    const open = {
      kind: 'remote-spark:open',
      id: ID,
      name: 'Studio Mac',
      hostname: 'studio.tail1234.ts.net',
      deviceName: 'Laptop',
      code: null,
      cookie: null,
    };
    expect(remoteSparkBridgeToHostSchema.safeParse(open).success).toBe(true);
    expect(remoteSparkBridgeToHostSchema.safeParse({ ...open, cookie: 'abc' }).success).toBe(true);
    expect(remoteSparkBridgeToHostSchema.safeParse({ ...open, cookie: '' }).success).toBe(false);
    expect(
      remoteSparkBridgeToHostSchema.safeParse({ ...open, hostname: '127.0.0.1' }).success,
    ).toBe(false);
  });

  it('refuses a captured cookie with no value or an oversized one', () => {
    const cookie = { kind: 'remote-spark:cookie', id: ID, hostname: 'studio.tail1234.ts.net' };
    expect(remoteSparkBridgeFromHostSchema.safeParse({ ...cookie, value: 'v' }).success).toBe(true);
    expect(remoteSparkBridgeFromHostSchema.safeParse({ ...cookie, value: '' }).success).toBe(false);
    expect(
      remoteSparkBridgeFromHostSchema.safeParse({ ...cookie, value: 'v'.repeat(513) }).success,
    ).toBe(false);
  });
});

describe('remoteNeedsYou', () => {
  const item = (over: Record<string, unknown>) => ({
    key: 'approval:1',
    kind: 'approval' as const,
    blocking: true,
    conversationId: null,
    detail: null,
    at: '2026-11-25T00:00:00.000Z',
    readAt: null,
    setAsideAt: null,
    dismissedAt: null,
    ...over,
  });

  it('counts waiting cards and Terminal waits, never updates or handled items', () => {
    const list = {
      items: [
        item({}),
        item({ kind: 'terminal' }),
        item({ kind: 'run-done', blocking: false }),
        item({ readAt: '2026-11-25T00:01:00.000Z' }),
        item({ setAsideAt: '2026-11-25T00:01:00.000Z' }),
        item({ dismissedAt: '2026-11-25T00:01:00.000Z' }),
      ],
    };
    expect(remoteNeedsYou(list)).toBe(2);
  });

  it('stops at the largest count a status can carry', () => {
    expect(remoteNeedsYou({ items: Array.from({ length: 1200 }, () => item({})) })).toBe(999);
  });
});

describe('watch and status messages', () => {
  it('accepts a watch list of paired Sparks and a status for one', () => {
    const spark = { id: ID, hostname: 'studio.tail1234.ts.net', cookie: 'abc' };
    expect(
      remoteSparkBridgeToHostSchema.safeParse({ kind: 'remote-spark:watch', sparks: [spark] })
        .success,
    ).toBe(true);
    expect(
      remoteSparkBridgeToHostSchema.safeParse({
        kind: 'remote-spark:watch',
        sparks: [{ ...spark, cookie: '' }],
      }).success,
    ).toBe(false);
    const status = { kind: 'remote-spark:status', id: ID, status: 'online', needsYou: 3 };
    expect(remoteSparkBridgeFromHostSchema.safeParse(status).success).toBe(true);
    expect(remoteSparkBridgeFromHostSchema.safeParse({ ...status, needsYou: -1 }).success).toBe(
      false,
    );
    expect(
      remoteSparkBridgeFromHostSchema.safeParse({ ...status, status: 'signed-out' }).success,
    ).toBe(false);
  });
});
