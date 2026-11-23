import { describe, expect, it } from 'vitest';
import { windowsRecovery } from './clone-recovery-windows.ts';

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
    expect(windowsRecovery(marker, null, true, SELF)).toEqual({ action: 'keep' });
  });

  it('cleans up when the table cannot be read but the process is gone', () => {
    expect(windowsRecovery(marker, null, false, SELF)).toEqual({ action: 'clean' });
  });

  it('keeps a clone another running process owns', () => {
    const owner = { pid: 900, ppid: 1, foregroundGroup: 0, args: 'node api.js' };
    expect(windowsRecovery(marker, [owner, clone(900)], true, SELF)).toEqual({ action: 'keep' });
  });

  it('stops an orphaned clone with everything it started', () => {
    expect(windowsRecovery(marker, [clone(555), helper], true, SELF)).toEqual({
      action: 'stop',
      tree: [40, 41],
    });
  });

  it('stops a clone this process still parents', () => {
    const self = { pid: SELF, ppid: 1, foregroundGroup: 0, args: 'node api.js' };
    expect(windowsRecovery(marker, [self, clone(SELF)], true, SELF)).toMatchObject({
      action: 'stop',
    });
  });

  it('cleans up when the pid now belongs to something that is not this clone', () => {
    const other = { pid: 40, ppid: 1, foregroundGroup: 0, args: 'notepad.exe' };
    expect(windowsRecovery(marker, [other], true, SELF)).toEqual({ action: 'clean' });
    expect(windowsRecovery(marker, [helper], true, SELF)).toEqual({ action: 'clean' });
  });
});
