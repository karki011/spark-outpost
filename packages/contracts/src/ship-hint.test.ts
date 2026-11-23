import { describe, expect, it } from 'vitest';
import { GIT_INSTALL_HINT, gitInstallHint } from './ship.ts';

describe('how to install Git', () => {
  it("points the Mac at Apple's tools and Windows at Git for Windows", () => {
    expect(gitInstallHint('darwin')).toBe(GIT_INSTALL_HINT);
    expect(gitInstallHint('win32')).toContain('Git for Windows');
    expect(gitInstallHint('win32')).not.toContain('xcode-select');
  });
});
