import type * as Os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tempRoots } from './temp-dirs.ts';

const systemTemp = vi.hoisted(() => ({ value: null as string | null }));

vi.mock('node:os', async (original) => {
  const os = await original<typeof Os>();
  return { ...os, tmpdir: () => systemTemp.value ?? os.tmpdir() };
});

describe('tempRoots on Windows', () => {
  const platform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
    systemTemp.value = null;
  });

  it.each(['C:\\', '/c', '/c/'])('never counts a whole drive from TMPDIR=%s', (value) => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(tempRoots({ TMPDIR: value })).not.toContain('/c');
  });

  it('keeps an ordinary temp folder', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(tempRoots({ TMPDIR: 'C:\\Temp' })).toContain('/c/Temp');
  });

  it('never counts a whole drive when the system temp folder is one', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    systemTemp.value = 'C:\\';
    const roots = tempRoots({});
    expect(roots).not.toContain('/c');
    expect(roots).not.toContain('/tmp');
  });
});
