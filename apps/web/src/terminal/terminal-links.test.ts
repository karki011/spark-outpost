import { describe, expect, it, vi } from 'vitest';
import { openTerminalLink, type TerminalClick } from './terminal-links.ts';

function click(change: Partial<TerminalClick> = {}): TerminalClick {
  return {
    preventDefault: vi.fn(),
    target: null,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    ...change,
  };
}

const noPane = () => false;

describe('openTerminalLink', () => {
  it('opens http and https links in a new tab without opener or referrer', () => {
    const open = vi.fn();
    const event = click();
    expect(
      openTerminalLink(event, 'https://console.anthropic.com/settings/keys', open, noPane),
    ).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      'https://console.anthropic.com/settings/keys',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('refuses other protocols and malformed links', () => {
    const open = vi.fn();
    const openInChat = vi.fn(() => true);
    const event = click();
    expect(openTerminalLink(event, 'javascript:alert(1)', open, openInChat)).toBe(false);
    expect(openTerminalLink(event, 'file:///etc/passwd', open, openInChat)).toBe(false);
    expect(openTerminalLink(event, 'not a url', open, openInChat)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(openInChat).not.toHaveBeenCalled();
  });

  it('hands the link to the chat’s Browser pane when it takes it', () => {
    const open = vi.fn();
    const openInChat = vi.fn(() => true);
    const target = {} as EventTarget;
    expect(openTerminalLink(click({ target }), 'https://example.com/a', open, openInChat)).toBe(
      true,
    );
    expect(openInChat).toHaveBeenCalledWith(
      'https://example.com/a',
      expect.objectContaining({ button: 0, metaKey: false, defaultPrevented: false }),
      target,
    );
    expect(open).not.toHaveBeenCalled();
  });

  it('passes the modifier keys on, so a Command-click can stay with the system', () => {
    const open = vi.fn();
    const openInChat = vi.fn(() => false);
    openTerminalLink(click({ metaKey: true }), 'https://example.com/a', open, openInChat);
    expect(openInChat).toHaveBeenCalledWith(
      'https://example.com/a',
      expect.objectContaining({ metaKey: true }),
      null,
    );
    expect(open).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener,noreferrer');
  });
});
