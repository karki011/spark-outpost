import { describe, expect, it } from 'vitest';
import { pairingLink } from '@spark-outpost/contracts';
import { QR_QUIET_ZONE, qrMatrix } from './qr-matrix.ts';

describe('QR matrix', () => {
  const link = pairingLink('spark-mac.tail1234.ts.net', 'ABCD-EFGH-JKLM');

  it('encodes the pairing link the phone page reads', () => {
    expect(link).toBe('https://spark-mac.tail1234.ts.net/#code=ABCD-EFGH-JKLM');
  });

  it('keeps a four-module quiet zone around the code', () => {
    const matrix = qrMatrix(link);
    const cells = [...matrix.path.matchAll(/M(\d+) (\d+)/g)].map(([, x, y]) => [
      Number(x),
      Number(y),
    ]);
    const inner = matrix.size - QR_QUIET_ZONE;
    expect(cells.length).toBeGreaterThan(200);
    expect(cells.every(([x, y]) => x! >= QR_QUIET_ZONE && y! >= QR_QUIET_ZONE)).toBe(true);
    expect(cells.every(([x, y]) => x! < inner && y! < inner)).toBe(true);
    expect(cells).toContainEqual([QR_QUIET_ZONE, QR_QUIET_ZONE]);
  });

  it('is stable for the same text and changes with the code', () => {
    expect(qrMatrix(link).path).toBe(qrMatrix(link).path);
    expect(qrMatrix(pairingLink('spark-mac.tail1234.ts.net', 'ZZZZ-EFGH-JKLM')).path).not.toBe(
      qrMatrix(link).path,
    );
  });
});
