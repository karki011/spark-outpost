import { describe, expect, it } from 'vitest';
import { fullDiskAccessStatus, type ReadDirFn } from './full-disk-access.ts';

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe('full disk access detection', () => {
  it('reports unsupported off macOS without touching the filesystem', async () => {
    const readDir: ReadDirFn = () => {
      throw new Error('should not be called');
    };
    const result = await fullDiskAccessStatus('linux', readDir, '/home/me');
    expect(result).toEqual({ status: 'unsupported' });
  });

  it('reports granted when any protected folder can be listed', async () => {
    const seen: string[] = [];
    const readDir: ReadDirFn = async (target) => {
      seen.push(target);
      if (target.endsWith('Mail')) return [];
      throw errno('EPERM');
    };
    const result = await fullDiskAccessStatus('darwin', readDir, '/Users/me');
    expect(result).toEqual({ status: 'granted' });
    expect(seen.length).toBeGreaterThan(0);
  });

  it('reports not_granted when every existing folder refuses with EPERM or EACCES', async () => {
    const readDir: ReadDirFn = async (target) => {
      throw errno(target.includes('Mail') ? 'EACCES' : 'EPERM');
    };
    const result = await fullDiskAccessStatus('darwin', readDir, '/Users/me');
    expect(result).toEqual({ status: 'not_granted' });
  });

  it('reports unknown when none of the protected folders exist', async () => {
    const readDir: ReadDirFn = async () => {
      throw errno('ENOENT');
    };
    const result = await fullDiskAccessStatus('darwin', readDir, '/Users/me');
    expect(result).toEqual({ status: 'unknown' });
  });
});
