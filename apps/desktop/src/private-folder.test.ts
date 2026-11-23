import { describe, expect, it } from 'vitest';
import { makeFolderPrivate, privateFolderArgs, userSid } from './private-folder.ts';

const WHOAMI = '"desktop-1\\hazel","S-1-5-21-1004336348-1177238915-682003330-1001"\r\n';
const SID = 'S-1-5-21-1004336348-1177238915-682003330-1001';

describe('private data folder on Windows', () => {
  it('reads the user id from whoami', () => {
    expect(userSid(WHOAMI)).toBe(SID);
    expect(userSid('nothing here')).toBeNull();
  });

  it('keeps only the user, SYSTEM and Administrators, inherited by everything inside', () => {
    expect(privateFolderArgs('C:\\Spark', SID)).toEqual([
      'C:\\Spark',
      '/inheritance:r',
      '/grant:r',
      `*${SID}:(OI)(CI)F`,
      '/grant:r',
      '*S-1-5-18:(OI)(CI)F',
      '/grant:r',
      '*S-1-5-32-544:(OI)(CI)F',
    ]);
  });

  it('runs the tools from System32 by full path', () => {
    const calls: string[] = [];
    makeFolderPrivate('C:\\Spark', {
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      run: (file) => {
        calls.push(file);
        return WHOAMI;
      },
    });
    expect(calls).toEqual([
      'C:\\Windows\\System32\\whoami.exe',
      'C:\\Windows\\System32\\icacls.exe',
    ]);
  });

  it('does nothing on other platforms', () => {
    const calls: string[] = [];
    makeFolderPrivate('/tmp/x', { platform: 'darwin', run: (file) => (calls.push(file), '') });
    expect(calls).toEqual([]);
  });
});
