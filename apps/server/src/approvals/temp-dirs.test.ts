import { afterEach, describe, expect, it } from 'vitest';
import { tempRoots } from './temp-dirs.ts';

describe('tempRoots on Windows', () => {
  const platform = process.platform;
  afterEach(() => Object.defineProperty(process, 'platform', { value: platform }));

  it.each(['C:\\', '/c', '/c/'])('never counts a whole drive from TMPDIR=%s', (value) => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(tempRoots({ TMPDIR: value })).not.toContain('/c');
  });

  it('keeps an ordinary temp folder', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(tempRoots({ TMPDIR: 'C:\\Temp' })).toContain('/c/Temp');
  });
});
