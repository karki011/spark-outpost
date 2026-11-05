import { createHash } from 'node:crypto';

export interface ChainRow {
  runId: string;
  seq: number;
  at: string;
  direction: string;
  kind: string;
  method: string | null;
  rpcId: string | null;
  sizeBytes: number;
  truncated: boolean;
  payload: unknown;
  unreviewed?: boolean;
}

export interface HashedRow extends ChainRow {
  prevHash: string | null;
  hash: string;
}

export interface ChainCheck {
  intact: boolean;
  checked: number;
  firstBrokenSeq: number | null;
  reason: string | null;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function rowHash(prevHash: string | null, row: ChainRow): string {
  const content = canonicalJson({
    runId: row.runId,
    seq: row.seq,
    at: row.at,
    direction: row.direction,
    kind: row.kind,
    method: row.method,
    rpcId: row.rpcId,
    sizeBytes: row.sizeBytes,
    truncated: row.truncated,
    payload: row.payload,
    unreviewed: row.unreviewed === true ? true : undefined,
  });
  return createHash('sha256')
    .update(prevHash ?? '')
    .update('\n')
    .update(content)
    .digest('hex');
}

export function chainRows(
  previous: { seq: number; hash: string } | null,
  rows: readonly Omit<ChainRow, 'seq'>[],
): HashedRow[] {
  let prevHash = previous?.hash ?? null;
  let seq = previous?.seq ?? 0;
  return rows.map((row) => {
    seq += 1;
    const chained = { ...row, seq };
    const hash = rowHash(prevHash, chained);
    const hashed = { ...chained, prevHash, hash };
    prevHash = hash;
    return hashed;
  });
}

export interface ChainPosition {
  checked: number;
  prevHash: string | null;
}

export const CHAIN_START: ChainPosition = { checked: 0, prevHash: null };

export function verifyChain(
  rows: readonly HashedRow[],
  from: ChainPosition = CHAIN_START,
): ChainCheck & ChainPosition {
  let { checked, prevHash } = from;
  for (const row of rows) {
    const broken = (reason: string) => ({
      intact: false,
      checked,
      prevHash,
      firstBrokenSeq: row.seq,
      reason,
    });
    if (row.seq !== checked + 1) return broken(`expected seq ${checked + 1}`);
    if (row.prevHash !== prevHash) return broken('prev_hash does not match the previous row');
    if (rowHash(prevHash, row) !== row.hash) return broken('hash does not match the row content');
    prevHash = row.hash;
    checked += 1;
  }
  return { intact: true, checked, prevHash, firstBrokenSeq: null, reason: null };
}
