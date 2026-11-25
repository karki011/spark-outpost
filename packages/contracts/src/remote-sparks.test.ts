import { describe, expect, it } from 'vitest';
import {
  parseSparkAddress,
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
    ['https://studio.example.com', 'reach'],
    ['https://ts.net.example.com', 'reach'],
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
  it('names the reach of a Serve hostname and nothing else', () => {
    expect(reachOfHostname('studio.tail1234.ts.net')).toBe('tailscale');
    expect(reachOfHostname('studio.example.com')).toBeNull();
    expect(reachOfHostname('ts.net')).toBeNull();
  });
});

describe('sparkPairingEntry', () => {
  it('carries the code, this Mac’s name and the kind in the fragment', () => {
    const entry = new URL(
      sparkPairingEntry('studio.tail1234.ts.net', 'Ann’s MacBook & co', 'AB12'),
    );
    expect(entry.origin).toBe('https://studio.tail1234.ts.net');
    expect(entry.search).toBe('');
    const params = new URLSearchParams(entry.hash.slice(1));
    expect(params.get('code')).toBe('AB12');
    expect(params.get('name')).toBe('Ann’s MacBook & co');
    expect(params.get('kind')).toBe('spark');
  });

  it('leaves the code out when there is none and bounds the name', () => {
    const entry = new URL(sparkPairingEntry('studio.tail1234.ts.net', 'x'.repeat(200), null));
    const params = new URLSearchParams(entry.hash.slice(1));
    expect(params.has('code')).toBe(false);
    expect(params.get('name')).toHaveLength(60);
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
