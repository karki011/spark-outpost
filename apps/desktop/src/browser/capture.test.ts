import { describe, expect, it } from 'vitest';
import { BoundedLog, withoutQuery } from './bounded-log.ts';
import { paintBoxes, quadBox, scaledBox } from './mask.ts';

const entry = (text: string, level = 'log') => ({
  level,
  text,
  source: null,
  status: null,
  method: null,
});

describe('bounded page logs', () => {
  it('keeps the newest entries and counts what it dropped', () => {
    const log = new BoundedLog(3);
    for (const text of ['a', 'b', 'c', 'd', 'e']) log.push(entry(text));
    expect(log.recent(undefined, 10).map((item) => item.text)).toEqual(['c', 'd', 'e']);
    expect(log.dropped()).toBe(2);
    expect(log.recent(undefined, 2).map((item) => item.text)).toEqual(['d', 'e']);
  });

  it('filters without regard to case and clips long text', () => {
    const log = new BoundedLog();
    log.push(entry('Widget FAILED to load', 'error'));
    log.push(entry('x'.repeat(5000)));
    expect(log.recent('failed', 10)).toHaveLength(1);
    expect(log.recent('error', 10)).toHaveLength(1);
    expect(log.recent(undefined, 10)[1]!.text.length).toBeLessThanOrEqual(500);
  });

  it('never keeps a query string', () => {
    expect(withoutQuery('http://localhost:3000/api?token=secret#x')).toBe(
      'http://localhost:3000/api?…',
    );
    expect(withoutQuery('http://localhost:3000/api')).toBe('http://localhost:3000/api');
  });
});

describe('screenshot masking', () => {
  it('paints only the pixels inside the box', () => {
    const size = { width: 4, height: 3 };
    const bitmap = Buffer.alloc(size.width * size.height * 4, 255);
    const painted = paintBoxes(bitmap, size, [{ x: 1, y: 1, width: 2, height: 1 }]);
    const pixel = (x: number, y: number) => painted[(y * size.width + x) * 4];
    expect(pixel(0, 1)).toBe(255);
    expect(pixel(1, 1)).toBe(96);
    expect(pixel(2, 1)).toBe(96);
    expect(pixel(3, 1)).toBe(255);
    expect(pixel(1, 0)).toBe(255);
    expect(bitmap[(1 * size.width + 1) * 4]).toBe(255);
  });

  it('clips boxes that reach outside the image', () => {
    const size = { width: 2, height: 2 };
    const painted = paintBoxes(Buffer.alloc(16, 255), size, [
      { x: -5, y: -5, width: 100, height: 100 },
    ]);
    expect([...painted].filter((byte) => byte === 96)).toHaveLength(12);
  });

  it('maps page boxes into the scaled crop', () => {
    expect(scaledBox({ x: 110, y: 60, width: 40, height: 20 }, 0.5, { x: 100, y: 50 })).toEqual({
      x: 5,
      y: 5,
      width: 20,
      height: 10,
    });
    expect(quadBox([10, 20, 50, 20, 50, 40, 10, 40])).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 20,
    });
    expect(quadBox([1, 2])).toBeNull();
  });
});
