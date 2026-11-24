import { describe, expect, it } from 'vitest';
import { ScrollBack } from './scroll-back.ts';

describe('the scroll-back buffer', () => {
  it('keeps everything while under its limit', () => {
    const buffer = new ScrollBack(100);
    buffer.push('one\r\n');
    buffer.push('');
    buffer.push('two');
    expect(buffer.text()).toBe('one\r\ntwo');
    expect(buffer.size).toBe(8);
  });

  it('drops the oldest output at a line start once over its limit', () => {
    const buffer = new ScrollBack(24);
    buffer.push('first line\n');
    buffer.push('second line\n');
    buffer.push('third');
    expect(buffer.text()).toBe('second line\nthird');
    expect(buffer.size).toBeLessThanOrEqual(24);
  });

  it('cuts mid-line when no line break is near enough', () => {
    const buffer = new ScrollBack(8);
    buffer.push('abcdefghijklmnop');
    expect(buffer.text()).toBe('ijklmnop');
  });
});
