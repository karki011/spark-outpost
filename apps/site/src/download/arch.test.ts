import { describe, expect, it } from 'vitest';
import { dmgUrl, guessArch, readArchHints } from './arch.ts';

describe('guessArch', () => {
  it('trusts Chromium client hints on a Mac', () => {
    expect(guessArch({ platform: 'macOS', architecture: 'arm', bitness: '64' })).toEqual({
      arch: 'arm64',
      sure: true,
    });
    expect(guessArch({ platform: 'macOS', architecture: 'x86', bitness: '64' })).toEqual({
      arch: 'x64',
      sure: true,
    });
  });

  it('falls back to Apple silicon, unsure, without hints or off a Mac', () => {
    expect(guessArch(null)).toEqual({ arch: 'arm64', sure: false });
    expect(guessArch({ platform: 'Windows', architecture: 'x86' })).toEqual({
      arch: 'arm64',
      sure: false,
    });
    expect(guessArch({ platform: 'macOS', architecture: '' })).toEqual({
      arch: 'arm64',
      sure: false,
    });
  });
});

describe('readArchHints', () => {
  it('returns null for Safari and Firefox, which have no userAgentData', async () => {
    expect(await readArchHints({})).toBeNull();
  });

  it('returns null when the browser refuses the hints', async () => {
    const refused = {
      userAgentData: { getHighEntropyValues: () => Promise.reject(new Error('no')) },
    };
    expect(await readArchHints(refused)).toBeNull();
  });

  it('fills the platform from the low-entropy value', async () => {
    const chrome = {
      userAgentData: {
        platform: 'macOS',
        getHighEntropyValues: async () => ({ architecture: 'arm', bitness: '64' }),
      },
    };
    expect(await readArchHints(chrome)).toEqual({
      platform: 'macOS',
      architecture: 'arm',
      bitness: '64',
    });
  });
});

describe('dmgUrl', () => {
  it('points at the stable latest names on the update feed', () => {
    expect(dmgUrl('x64')).toBe(
      'https://pub-aae3512121074a13b84ee166f8d153af.r2.dev/Spark-Outpost-latest-x64.dmg',
    );
  });
});
