// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openOutside, outsideTarget } from './outside-link.ts';

afterEach(() => vi.unstubAllGlobals());

describe('outside links', () => {
  it('asks the Mac app for the default browser, whatever Open links in says', () => {
    vi.stubGlobal('sparkDesktop', {});
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openOutside('https://accounts.google.com/o/oauth2/v2/auth');
    expect(open).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/v2/auth',
      'spark-outside',
      'noopener,noreferrer',
    );
    open.mockRestore();
  });

  it('opens an ordinary new tab in a browser or on a paired device', () => {
    expect(outsideTarget()).toBe('_blank');
  });
});
