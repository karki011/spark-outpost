import { describe, expect, it } from 'vitest';
import { isWindowsPath, nativeOrNull, toGatePath, toNativePath } from './gate-path.ts';

describe('gate paths on Windows', () => {
  it('writes a drive path the way Git Bash does', () => {
    expect(toGatePath('C:\\Users\\Me\\repo', 'win32')).toBe('/c/Users/Me/repo');
    expect(toGatePath('D:/work/app/', 'win32')).toBe('/d/work/app/');
    expect(toGatePath('C:\\', 'win32')).toBe('/c');
    expect(toGatePath('c:', 'win32')).toBe('/c');
  });

  it('keeps a network share and a path already in Git Bash form', () => {
    expect(toGatePath('\\\\server\\share\\dir\\a.txt', 'win32')).toBe('//server/share/dir/a.txt');
    expect(toGatePath('/c/Users/me', 'win32')).toBe('/c/Users/me');
    expect(toGatePath('/tmp/x', 'win32')).toBe('/tmp/x');
    expect(toGatePath('src\\index.ts', 'win32')).toBe('src\\index.ts');
  });

  it('turns a Git Bash drive path back into a native one for file access', () => {
    expect(toNativePath('/c/Users/Me/repo', 'win32')).toBe('C:\\Users\\Me\\repo');
    expect(toNativePath('/d', 'win32')).toBe('D:\\');
    expect(toNativePath(toGatePath('E:\\a\\b c\\d', 'win32'), 'win32')).toBe('E:\\a\\b c\\d');
  });

  it('finds the Git Bash /tmp in the Windows temp folder and nothing for other mounts', () => {
    expect(nativeOrNull('/tmp/x/y', 'win32', 'C:\\Temp')).toBe('C:\\Temp\\x\\y');
    expect(nativeOrNull('/tmp', 'win32', 'C:\\Temp')).toBe('C:\\Temp');
    expect(nativeOrNull('/usr/bin/env', 'win32')).toBeNull();
    expect(nativeOrNull('/Users/me', 'win32')).toBeNull();
    expect(nativeOrNull('/Users/me', 'darwin')).toBe('/Users/me');
  });

  it('changes nothing on macOS and Linux', () => {
    expect(toGatePath('/Users/me/repo', 'darwin')).toBe('/Users/me/repo');
    expect(toGatePath('C:\\odd\\name', 'linux')).toBe('C:\\odd\\name');
    expect(toNativePath('/c/Users', 'darwin')).toBe('/c/Users');
  });

  it('recognises Windows paths written in a command', () => {
    expect(isWindowsPath('C:\\Users\\me\\.ssh\\id_rsa')).toBe(true);
    expect(isWindowsPath('c:/temp/out.txt')).toBe(true);
    expect(isWindowsPath('\\\\server\\share\\x')).toBe(true);
    expect(isWindowsPath('/c/Users')).toBe(false);
    expect(isWindowsPath('http://x')).toBe(false);
  });
});
