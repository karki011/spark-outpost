import { describe, expect, it } from 'vitest';
import { REMOTE_SPARK_ICON_MAX_BYTES } from '@spark-outpost/contracts';
import { iconBody, pngBytes } from '../../test/remote-sparks-support.ts';
import { isSparkIconPng, sparkIconFrom } from './icon.ts';

describe('a Spark icon', () => {
  it('is a PNG between 16 and 256 pixels a side', () => {
    expect(isSparkIconPng(pngBytes(96, 96))).toBe(true);
    expect(isSparkIconPng(pngBytes(16, 256))).toBe(true);
    expect(isSparkIconPng(pngBytes(1, 1))).toBe(false);
    expect(isSparkIconPng(pngBytes(15, 96))).toBe(false);
    expect(isSparkIconPng(pngBytes(96, 257))).toBe(false);
    expect(isSparkIconPng(pngBytes(4000, 4000))).toBe(false);
  });

  it('is refused without the PNG signature or an IHDR chunk first', () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60)]);
    const noHeader = pngBytes(96, 96);
    noHeader.write('IDAT', 12, 'latin1');
    const oddLength = pngBytes(96, 96);
    oddLength.writeUInt32BE(14, 8);

    expect(isSparkIconPng(jpeg)).toBe(false);
    expect(isSparkIconPng(noHeader)).toBe(false);
    expect(isSparkIconPng(oddLength)).toBe(false);
    expect(isSparkIconPng(pngBytes(96, 96).subarray(0, 20))).toBe(false);
    expect(isSparkIconPng(Buffer.alloc(0))).toBe(false);
  });

  it('is refused over the size limit', () => {
    const atLimit = Buffer.concat([pngBytes(96, 96), Buffer.alloc(REMOTE_SPARK_ICON_MAX_BYTES)]);

    expect(isSparkIconPng(atLimit.subarray(0, REMOTE_SPARK_ICON_MAX_BYTES))).toBe(true);
    expect(isSparkIconPng(atLimit.subarray(0, REMOTE_SPARK_ICON_MAX_BYTES + 1))).toBe(false);
  });

  it('is read from a request body only when it is base64 of such a PNG', () => {
    const png = pngBytes(96, 96);

    expect(sparkIconFrom(iconBody(png))).toEqual(png);
    expect(sparkIconFrom({ png: 'not base64!' })).toBeNull();
    expect(sparkIconFrom({ png: '' })).toBeNull();
    expect(sparkIconFrom({ png: 7 })).toBeNull();
    expect(sparkIconFrom({})).toBeNull();
    expect(sparkIconFrom(null)).toBeNull();
    expect(
      sparkIconFrom(iconBody(Buffer.from('plain text, long enough to hold a header'))),
    ).toBeNull();
  });
});
