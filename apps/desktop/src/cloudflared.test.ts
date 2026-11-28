import { describe, expect, it } from 'vitest';
import { cloudflaredBin, cloudflaredFile, cloudflaredFolder } from './cloudflared.ts';

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

  it('is left out on an older macOS and on Linux', () => {
    expect(cloudflaredBin({ ...base, systemVersion: '14.7.1' })).toBe('');
    expect(cloudflaredBin({ ...base, platform: 'linux', systemVersion: '6.8.0' })).toBe('');
  });

  it('is used on Windows whatever its version', () => {
    const bundled = 'C:\\Spark\\resources\\cloudflared\\bin\\cloudflared.exe';
    const windows = { ...base, bundled, platform: 'win32' as NodeJS.Platform };
    expect(cloudflaredBin({ ...windows, systemVersion: '10.0.26100' })).toBe(bundled);
    expect(cloudflaredBin({ ...windows, systemVersion: '10.0.19045' })).toBe(bundled);
  });

  it('is an exe in its own folder on Windows', () => {
    expect(cloudflaredFile('win32')).toBe('cloudflared.exe');
    expect(cloudflaredFile('darwin')).toBe('cloudflared');
    expect(cloudflaredFolder('win32', 'x64')).toBe('win-x64');
    expect(cloudflaredFolder('darwin', 'x64')).toBe('x64');
  });

  it('gives way to a path named in the environment only when run from source', () => {
    const override = '/opt/homebrew/bin/cloudflared';
    expect(cloudflaredBin({ ...base, isPackaged: false, systemVersion: '14.0', override })).toBe(
      override,
    );
    expect(cloudflaredBin({ ...base, override })).toBe(base.bundled);
  });
});
