// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BetaBadge } from './BetaBadge.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function badge(version: string, platform: string): string {
  vi.stubGlobal('sparkDesktop', { platform });
  return render(<BetaBadge version={version} />).container.textContent ?? '';
}

describe('the release badge', () => {
  it('marks a Mac beta as Beta and a Mac release as nothing', () => {
    expect(badge('0.1.0-beta.17', 'darwin')).toBe('Beta');
    expect(badge('0.1.0', 'darwin')).toBe('');
  });

  it('marks every Windows build as Alpha', () => {
    expect(badge('0.1.0-beta.17', 'win32')).toBe('Alpha');
    expect(badge('0.1.0', 'win32')).toBe('Alpha');
  });
});
