import { describe, expect, it } from 'vitest';
import { hostWords } from './host-words.ts';

describe('hostWords', () => {
  it('keeps the Mac words off Windows', () => {
    expect(hostWords(false)).toEqual({
      computer: 'Mac',
      tray: 'menu bar',
      taskbar: 'Dock',
      fileManager: 'Finder',
    });
  });

  it('uses the Windows words on Windows', () => {
    expect(hostWords(true)).toEqual({
      computer: 'PC',
      tray: 'system tray',
      taskbar: 'taskbar',
      fileManager: 'File Explorer',
    });
  });
});
