import { describe, expect, it } from 'vitest';
import { canonicalJson, chainRows, rowHash, verifyChain, type HashedRow } from './hash-chain.ts';

const row = (index: number) => ({
  runId: '00000000-0000-4000-8000-000000000001',
  at: `2026-09-26T10:00:0${index}.000Z`,
  direction: 'to_agent',
  kind: 'request',
  method: 'session/prompt',
  rpcId: String(index),
  sizeBytes: 10 + index,
  truncated: false,
  payload: { b: [1, { d: 2, c: 3 }], a: `text ${index}` },
});

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined fields', () => {
    expect(canonicalJson({ b: 1, a: { z: [3, { y: 1, x: 2 }], w: undefined } })).toBe(
      '{"a":{"z":[3,{"x":2,"y":1}]},"b":1}',
    );
  });

  it('gives the same text for the same value in any key order', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
});

describe('hash chain', () => {
  it('links each row to the one before it', () => {
    const rows = chainRows(null, [row(1), row(2), row(3)]);
    expect(rows.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(rows[0]!.prevHash).toBeNull();
    expect(rows[1]!.prevHash).toBe(rows[0]!.hash);
    expect(rows[2]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyChain(rows)).toMatchObject({ intact: true, checked: 3 });
  });

  it('continues from the last stored row', () => {
    const first = chainRows(null, [row(1)]);
    const next = chainRows({ seq: 1, hash: first[0]!.hash }, [row(2)]);
    expect(next[0]).toMatchObject({ seq: 2, prevHash: first[0]!.hash });
    expect(verifyChain([...first, ...next]).intact).toBe(true);
  });

  it('verifies in pages', () => {
    const rows = chainRows(null, [row(1), row(2), row(3)]);
    const firstPage = verifyChain(rows.slice(0, 2));
    expect(verifyChain(rows.slice(2), firstPage)).toMatchObject({ intact: true, checked: 3 });
  });

  it('does not depend on the key order of a stored payload', () => {
    const [stored] = chainRows(null, [row(1)]);
    const reordered: HashedRow = { ...stored!, payload: { a: 'text 1', b: [1, { c: 3, d: 2 }] } };
    expect(verifyChain([reordered]).intact).toBe(true);
  });

  it('hashes the ran-without-review mark, and leaves unmarked rows as before', () => {
    const [plain] = chainRows(null, [row(1)]);
    const [marked] = chainRows(null, [{ ...row(1), unreviewed: true }]);
    expect(chainRows(null, [{ ...row(1), unreviewed: false }])[0]!.hash).toBe(plain!.hash);
    expect(marked!.hash).not.toBe(plain!.hash);
    const { unreviewed, ...unmarked } = marked!;
    expect(unreviewed).toBe(true);
    expect(verifyChain([unmarked]).intact).toBe(false);
  });

  it.each([
    ['an edited payload', (rows: HashedRow[]) => (rows[1]!.payload = { a: 'changed' })],
    ['an edited method', (rows: HashedRow[]) => (rows[1]!.method = 'session/cancel')],
    ['a recomputed hash', (rows: HashedRow[]) => (rows[1]!.hash = rowHash(null, rows[1]!))],
  ])('detects %s', (_name, tamper) => {
    const rows = chainRows(null, [row(1), row(2), row(3)]);
    tamper(rows);
    expect(verifyChain(rows)).toMatchObject({ intact: false, firstBrokenSeq: 2, checked: 1 });
  });

  it('detects a deleted or reordered row', () => {
    const rows = chainRows(null, [row(1), row(2), row(3)]);
    expect(verifyChain([rows[0]!, rows[2]!])).toMatchObject({
      intact: false,
      firstBrokenSeq: 3,
      reason: 'expected seq 2',
    });
    expect(verifyChain([rows[1]!, rows[0]!])).toMatchObject({ intact: false, firstBrokenSeq: 2 });
  });

  it('treats an empty log as intact', () => {
    expect(verifyChain([])).toMatchObject({ intact: true, checked: 0 });
  });
});
