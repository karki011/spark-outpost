import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { within } from './folder-in-use.ts';

describe('within', () => {
  it('counts the folder itself and anything below it on macOS', () => {
    expect(within('/w/chat', '/w/chat', path.posix)).toBe(true);
    expect(within('/w/chat/src/app', '/w/chat/', path.posix)).toBe(true);
    expect(within('/w/chat-2', '/w/chat', path.posix)).toBe(false);
    expect(within('/w', '/w/chat', path.posix)).toBe(false);
    expect(within('/w/chat/..foo', '/w/chat', path.posix)).toBe(true);
  });

  it('reads Windows paths with backslashes and any letter case', () => {
    expect(within('C:\\w\\chat\\src', 'C:\\w\\chat', path.win32)).toBe(true);
    expect(within('c:\\W\\Chat', 'C:\\w\\chat\\', path.win32)).toBe(true);
    expect(within('C:\\w\\chat-2', 'C:\\w\\chat', path.win32)).toBe(false);
    expect(within('D:\\w\\chat', 'C:\\w\\chat', path.win32)).toBe(false);
  });
});
