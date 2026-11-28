import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { binaryProblems } from './bundled-binary.ts';
import {
  CLOUDFLARED,
  CLOUDFLARED_LICENCE,
  CLOUDFLARED_VERSION,
  CLOUDFLARED_WINDOWS,
  cloudflaredBinaryPath,
  cloudflaredBuiltDir,
  cloudflaredPinned,
  cloudflaredStamp,
  windowsBinaryProblem,
} from './cloudflared-bundle.ts';

const SYSTEM = [
  '/out/bin/cloudflared:',
  '\t/usr/lib/libresolv.9.dylib (compatibility version 1.0.0, current version 1.0.0)',
  '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)',
  '',
].join('\n');

describe('the cloudflared bundled for Windows', () => {
  it("pins Cloudflare's x64 exe by sha256 and keeps it apart from the Mac files", () => {
    expect(CLOUDFLARED_WINDOWS).toEqual({
      url: `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-windows-amd64.exe`,
      sha256: '555b46c85582461d189cac30d14ad05480d612613801be9f110b8ce08c5b2113',
    });
    expect(cloudflaredPinned('x64', 'win')).toBe(CLOUDFLARED_WINDOWS);
    expect(() => cloudflaredPinned('arm64', 'win')).toThrow('x64 only');
    expect(cloudflaredStamp('x64', 'win')).toBe(
      `${CLOUDFLARED_WINDOWS.sha256}\n${CLOUDFLARED_LICENCE.sha256}`,
    );
    expect(cloudflaredStamp('x64', 'win')).not.toBe(cloudflaredStamp('x64'));
    expect(cloudflaredBuiltDir('/repo', 'x64', 'win')).toBe(
      path.join('/repo', '.local/cloudflared/win-x64'),
    );
    expect(cloudflaredBinaryPath('win')).toBe(path.join('bin', 'cloudflared.exe'));
    expect(cloudflaredBinaryPath()).toBe(path.join('bin', 'cloudflared'));
  });

  it('refuses a missing exe and one that is not the pinned file', () => {
    expect(windowsBinaryProblem(null)).toContain('it is missing');
    expect(windowsBinaryProblem(Buffer.from('not cloudflared'))).toMatch(
      /^it has sha256 [0-9a-f]{64}; the pinned one is 555b46c8/,
    );
  });
});

describe.skipIf(process.platform === 'win32')('on macOS only: it builds the Mac app', () => {
  describe('the bundled cloudflared', () => {
    it("pins Cloudflare's release files for both CPUs and the licence by sha256", () => {
      expect(CLOUDFLARED.arm64).toEqual({
        url: `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-darwin-arm64.tgz`,
        sha256: 'f6d58eeec91ad1ec5fd1f7e4a587303772929b2625be5d24068033851c36ff55',
      });
      expect(CLOUDFLARED.x64).toEqual({
        url: `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-darwin-amd64.tgz`,
        sha256: '6153d9ec629174882a3adbff2f7dc5a24b4f3bdd7ccc38eaa84fba26eb890311',
      });
      expect(cloudflaredStamp('arm64')).toContain(CLOUDFLARED.arm64.sha256);
      expect(cloudflaredStamp('arm64')).toContain(CLOUDFLARED_LICENCE.sha256);
      expect(cloudflaredBuiltDir('/repo', 'x64')).toBe('/repo/.local/cloudflared/x64');
    });

    it('accepts a binary that needs macOS 15 and refuses one that needs a newer macOS', () => {
      const facts = { archs: 'arm64\n', otool: SYSTEM, minOs: '15.0' };
      expect(binaryProblems('arm64', facts, '15.0')).toEqual([]);
      expect(binaryProblems('arm64', { ...facts, minOs: '26.0' }, '15.0')).toEqual([
        'it needs macOS 26.0, newer than the allowed 15.0',
      ]);
    });
  });
});
