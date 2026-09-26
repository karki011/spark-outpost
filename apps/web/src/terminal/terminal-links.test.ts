import { describe, expect, it, vi } from 'vitest';
import { openTerminalLink } from './terminal-links.ts';

describe('openTerminalLink', () => {
  it('opens http and https links in a new tab without opener or referrer', () => {
    const open = vi.fn();
    const event = { preventDefault: vi.fn() };
    expect(openTerminalLink(event, 'https://console.anthropic.com/settings/keys', open)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      'https://console.anthropic.com/settings/keys',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('refuses other protocols and malformed links', () => {
    const open = vi.fn();
    const event = { preventDefault: vi.fn() };
    expect(openTerminalLink(event, 'javascript:alert(1)', open)).toBe(false);
    expect(openTerminalLink(event, 'file:///etc/passwd', open)).toBe(false);
    expect(openTerminalLink(event, 'not a url', open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
