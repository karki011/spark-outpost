// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { REMOTE_SPARK_ICON_MAX_BYTES, REMOTE_SPARK_ICON_TYPES } from '@spark-outpost/contracts';
import { ICON_PROBLEM } from './remote-sparks-copy.ts';
import { SPARK_ICON_ACCEPT, sparkIconPng } from './spark-icon-image.ts';

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const drawn = () => Promise.resolve(new Blob([PNG_BYTES], { type: 'image/png' }));

describe('sparkIconPng', () => {
  it.each(REMOTE_SPARK_ICON_TYPES)('converts a %s file to base64 PNG', async (type) => {
    const file = new File(['picture'], 'logo', { type });
    const draw = vi.fn(drawn);
    expect(await sparkIconPng(file, draw)).toBe('iVBORw0KGgo=');
    expect(draw).toHaveBeenCalledWith(file);
  });

  it('refuses a file of another type without drawing it', async () => {
    const draw = vi.fn(drawn);
    const file = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    await expect(sparkIconPng(file, draw)).rejects.toThrow(ICON_PROBLEM);
    expect(draw).not.toHaveBeenCalled();
  });

  it('refuses a file that cannot be decoded', async () => {
    const file = new File(['not a picture'], 'logo.png', { type: 'image/png' });
    const draw = () => Promise.reject(new Error('InvalidStateError'));
    await expect(sparkIconPng(file, draw)).rejects.toThrow(ICON_PROBLEM);
  });

  it('refuses a result over the size limit and accepts one at the limit', async () => {
    const file = new File(['picture'], 'logo.png', { type: 'image/png' });
    const sized = (bytes: number) => () => Promise.resolve(new Blob([new Uint8Array(bytes)]));
    await expect(sparkIconPng(file, sized(REMOTE_SPARK_ICON_MAX_BYTES + 1))).rejects.toThrow(
      ICON_PROBLEM,
    );
    await expect(sparkIconPng(file, sized(0))).rejects.toThrow(ICON_PROBLEM);
    const most = await sparkIconPng(file, sized(REMOTE_SPARK_ICON_MAX_BYTES));
    expect(most.length).toBe(Math.ceil(REMOTE_SPARK_ICON_MAX_BYTES / 3) * 4);
  });

  it('offers the four image types to the file picker', () => {
    expect(SPARK_ICON_ACCEPT).toBe('image/png,image/jpeg,image/webp,image/gif');
  });
});
