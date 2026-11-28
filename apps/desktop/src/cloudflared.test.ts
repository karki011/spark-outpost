import { describe, expect, it } from 'vitest';
import { cloudflaredBin } from './cloudflared.ts';

const base = {
  bundled: '/app/Resources/cloudflared/bin/cloudflared',
  override: undefined,
  isPackaged: true,
  platform: 'darwin' as NodeJS.Platform,
  systemVersion: '15.0',
};

describe('the bundled cloudflared', () => {
  it('is used on macOS 15 and later', () => {
    expect(cloudflaredBin(base)).toBe(base.bundled);
    expect(cloudflaredBin({ ...base, systemVersion: '26.5.2' })).toBe(base.bundled);
  });

  it('is left out on an older macOS and on other systems', () => {
    expect(cloudflaredBin({ ...base, systemVersion: '14.7.1' })).toBe('');
    expect(cloudflaredBin({ ...base, platform: 'win32', systemVersion: '10.0.26100' })).toBe('');
  });

  it('gives way to a path named in the environment only when run from source', () => {
    const override = '/opt/homebrew/bin/cloudflared';
    expect(cloudflaredBin({ ...base, isPackaged: false, systemVersion: '14.0', override })).toBe(
      override,
    );
    expect(cloudflaredBin({ ...base, override })).toBe(base.bundled);
  });
});
