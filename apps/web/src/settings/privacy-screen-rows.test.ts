import { describe, expect, it } from 'vitest';
import { privacyScreenRows } from './PrivacyScreenSection.tsx';

describe('privacy screen rows', () => {
  it('keeps the Mac rows, Touch ID included', () => {
    expect(privacyScreenRows(false)).toEqual([
      'Lock Spark when I’m away',
      'Lock after',
      'Lock when the Mac sleeps or its screen locks',
      'Unlock with Touch ID',
      'Hide notification text while locked',
      'Code',
    ]);
  });

  it('names the PC and Windows Hello on Windows', () => {
    expect(privacyScreenRows(true)).toEqual([
      'Lock Spark when I’m away',
      'Lock after',
      'Lock when the PC sleeps or its screen locks',
      'Unlock with Windows Hello',
      'Hide notification text while locked',
      'Code',
    ]);
  });
});
