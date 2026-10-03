import { describe, expect, it } from 'vitest';
import { FULL_DISK_ACCESS_SYSTEM_SETTINGS_URL } from '@spark-outpost/contracts';
import { openFullDiskAccess } from './privacy.ts';

describe('opening Full Disk Access in System Settings', () => {
  it('opens the fixed Apple settings URL when the request is trusted', () => {
    const opened: string[] = [];
    openFullDiskAccess(true, (url) => opened.push(url));
    expect(opened).toEqual([FULL_DISK_ACCESS_SYSTEM_SETTINGS_URL]);
  });

  it('opens nothing when the request is not trusted', () => {
    const opened: string[] = [];
    openFullDiskAccess(false, (url) => opened.push(url));
    expect(opened).toEqual([]);
  });
});
