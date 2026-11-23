import { describe, expect, it } from 'vitest';
import { treeStopped, windowsRecovery } from './clone-recovery-windows.ts';

const DEST = 'C:\\Users\\me\\work\\app';
const marker = { pid: 40, destination: DEST };
const SELF = 7;
const clone = (ppid: number) => ({
  pid: 40,
  ppid,
  foregroundGroup: 0,
  args: `"C:\\Program Files\\Git\\cmd\\git.exe" clone https://example.test/a.git ${DEST}`,
});
const helper = { pid: 41, ppid: 40, foregroundGroup: 0, args: 'git-remote-https.exe origin' };

describe('recovering an interrupted clone on Windows', () => {
  it('keeps the folder when the process table cannot be read and the clone may still run', () => {
    expect(windowsRecovery(marker, null, SELF)).toEqual({ action: 'keep' });
  });

  it('keeps the folder when the table cannot be read, even after the clone itself is gone', () => {
    expect(windowsRecovery({ ...marker, pid: 2 ** 22 + 9 }, null, SELF)).toEqual({
      action: 'keep',
    });
  });

  it('keeps a clone another running process owns', () => {
    const owner = { pid: 900, ppid: 1, foregroundGroup: 0, args: 'node api.js' };
    expect(windowsRecovery(marker, [owner, clone(900)], SELF)).toEqual({ action: 'keep' });
  });

  it('stops an orphaned clone with everything it started', () => {
    expect(windowsRecovery(marker, [clone(555), helper], SELF)).toEqual({
      action: 'stop',
      tree: [40, 41],
    });
  });

  it('stops a clone this process still parents', () => {
    const self = { pid: SELF, ppid: 1, foregroundGroup: 0, args: 'node api.js' };
    expect(windowsRecovery(marker, [self, clone(SELF)], SELF)).toMatchObject({
      action: 'stop',
    });
  });

  it('cleans up when the pid now belongs to something that is not this clone', () => {
    const other = { pid: 40, ppid: 1, foregroundGroup: 0, args: 'notepad.exe' };
    expect(windowsRecovery(marker, [other], SELF)).toEqual({ action: 'clean' });
  });

  it('keeps the folder while something the clone started outlives it', () => {
    expect(windowsRecovery(marker, [helper], SELF)).toEqual({ action: 'keep' });
  });

  it('counts the tree as stopped only when no member or child of one is left', () => {
    const other = { pid: 90, ppid: 1, foregroundGroup: 0, args: 'explorer.exe' };
    expect(treeStopped([40, 41], [other])).toBe(true);
    expect(treeStopped([40, 41], null)).toBe(false);
    expect(treeStopped([40, 41], [other, helper])).toBe(false);
    const late = { pid: 77, ppid: 41, foregroundGroup: 0, args: 'git-index-pack.exe' };
    expect(treeStopped([40, 41], [other, late])).toBe(false);
  });
});
