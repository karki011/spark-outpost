import { describe, expect, it } from 'vitest';
import { makeFolderPrivate, privateFolderScript } from './private-folder.ts';

describe('private data folder on Windows', () => {
  it('replaces the whole rule list with the user, SYSTEM and Administrators', () => {
    const script = privateFolderScript('C:\\Spark');
    expect(script).toContain('WindowsIdentity]::GetCurrent().User.Value');
    expect(script).toContain(
      '"D:PAI(A;OICI;FA;;;$sid)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)", \'Access\'',
    );
    expect(script).toContain("Set-Acl -LiteralPath 'C:\\Spark' -AclObject $acl");
  });

  it('keeps a quote in the folder name inside the string', () => {
    expect(privateFolderScript("C:\\Users\\o'neil\\Spark")).toContain(
      "-LiteralPath 'C:\\Users\\o''neil\\Spark'",
    );
  });

  it('doubles curly single quotes, which PowerShell also reads as quotes', () => {
    expect(privateFolderScript('C:\\Users\\O\u2019Neil\\Spark')).toContain(
      "-LiteralPath 'C:\\Users\\O\u2019\u2019Neil\\Spark'",
    );
  });

  it('runs PowerShell from System32 by full path', () => {
    const calls: string[] = [];
    makeFolderPrivate('C:\\Spark', {
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      run: (file) => (calls.push(file), ''),
    });
    expect(calls).toEqual(['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe']);
  });

  it('does nothing on other platforms', () => {
    const calls: string[] = [];
    makeFolderPrivate('/tmp/x', { platform: 'darwin', run: (file) => (calls.push(file), '') });
    expect(calls).toEqual([]);
  });
});
