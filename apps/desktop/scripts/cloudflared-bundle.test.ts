import { describe, expect, it } from 'vitest';
import { binaryProblems } from './bundled-binary.ts';
import {
  CLOUDFLARED,
  CLOUDFLARED_LICENCE,
  CLOUDFLARED_VERSION,
  cloudflaredBuiltDir,
  cloudflaredStamp,
} from './cloudflared-bundle.ts';

const SYSTEM = [
  '/out/bin/cloudflared:',
  '\t/usr/lib/libresolv.9.dylib (compatibility version 1.0.0, current version 1.0.0)',
  '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)',
  '',
].join('\n');

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
