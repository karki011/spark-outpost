import { describe, expect, it } from 'vitest';
import { unlockCopy } from './unlock-copy.ts';

describe('unlock copy', () => {
  it('names Touch ID and the Mac password on a Mac', () => {
    expect(unlockCopy(false)).toEqual({
      name: 'Touch ID',
      failed: 'Touch ID didn’t unlock Spark. Try again or enter your code.',
      recoverLine:
        'Confirm with your Mac password or Touch ID. The privacy screen turns off until you set a new code.',
      recoverButton: 'Use Mac password…',
    });
  });

  it('names Windows Hello on Windows', () => {
    expect(unlockCopy(true)).toEqual({
      name: 'Windows Hello',
      failed: 'Windows Hello didn’t unlock Spark. Try again or enter your code.',
      recoverLine:
        'Confirm with Windows Hello. The privacy screen turns off until you set a new code.',
      recoverButton: 'Use Windows Hello…',
    });
  });
});
