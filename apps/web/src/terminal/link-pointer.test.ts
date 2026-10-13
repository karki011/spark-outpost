// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { linkPress, terminalLinkFollower } from './link-pointer.ts';

const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

describe('a press on a terminal link', () => {
  it('opens the pane on a plain click and the default browser with Command', () => {
    expect(linkPress(plain, true)).toBe('pane');
    expect(linkPress({ ...plain, metaKey: true }, true)).toBe('browser');
  });

  it('shows the menu on a right click', () => {
    expect(linkPress({ ...plain, button: 2 }, true)).toBe('menu');
  });

  it('leaves selection gestures, other buttons and presses off a link to the terminal', () => {
    expect(linkPress({ ...plain, altKey: true }, true)).toBe('pass');
    expect(linkPress({ ...plain, shiftKey: true }, true)).toBe('pass');
    expect(linkPress({ ...plain, button: 2, altKey: true }, true)).toBe('pass');
    expect(linkPress({ ...plain, button: 1 }, true)).toBe('pass');
    expect(linkPress({ ...plain, ctrlKey: true }, true)).toBe('pass');
    expect(linkPress(plain, false)).toBe('pass');
    expect(linkPress({ ...plain, button: 2 }, false)).toBe('pass');
  });
});

function setup(mouseTrackingMode: 'none' | 'any' = 'any') {
  const element = document.createElement('div');
  const screen = document.createElement('div');
  screen.className = 'xterm-screen';
  element.append(screen);
  document.body.append(element);
  const opener = { open: vi.fn(), menu: vi.fn(() => true) };
  const terminal = { modes: { mouseTrackingMode }, focus: vi.fn() };
  const follower = terminalLinkFollower(opener);
  const stop = follower.follow(terminal as never, element);
  const reported = vi.fn();
  element.addEventListener('mousedown', reported);
  element.addEventListener('contextmenu', reported);
  const fire = (type: string, init: MouseEventInit = {}) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    screen.dispatchEvent(event);
    return event;
  };
  const hover = (uri: string) => follower.osc.hover!(new MouseEvent('mousemove'), uri, {} as never);
  return { follower, opener, terminal, reported, fire, hover, stop };
}

describe('following links in a terminal', () => {
  it('opens a hyperlink on a plain click and keeps that click from the CLI', () => {
    const t = setup();
    t.hover('https://example.com');
    const down = t.fire('mousedown');
    expect(t.reported).not.toHaveBeenCalled();
    expect(down.defaultPrevented).toBe(true);
    expect(t.terminal.focus).toHaveBeenCalled();
    t.follower.osc.activate(new MouseEvent('mouseup'), 'https://example.com', {} as never);
    expect(t.opener.open).toHaveBeenCalledExactlyOnceWith('https://example.com', 'pane');
  });

  it('opens a plain-text address the same way and the default browser with Command', () => {
    const t = setup();
    t.follower.webLinks.hover(new MouseEvent('mousemove'), 'https://example.org/x');
    t.follower.activate(new MouseEvent('mouseup', { metaKey: true }), 'https://example.org/x');
    expect(t.opener.open).toHaveBeenCalledExactlyOnceWith('https://example.org/x', 'browser');
  });

  it('passes every press that is not on a link to the CLI untouched', () => {
    const t = setup();
    t.fire('mousedown');
    t.fire('mousedown', { button: 2 });
    t.fire('contextmenu', { button: 2 });
    expect(t.reported).toHaveBeenCalledTimes(3);
    expect(t.opener.menu).not.toHaveBeenCalled();
    t.hover('https://example.com');
    t.follower.osc.leave!(new MouseEvent('mousemove'), 'https://example.com', {} as never);
    t.fire('mousedown');
    expect(t.reported).toHaveBeenCalledTimes(4);
  });

  it('keeps an Option press on a link for selection', () => {
    const t = setup();
    t.hover('https://example.com');
    t.fire('mousedown', { altKey: true });
    expect(t.reported).toHaveBeenCalledTimes(1);
    t.follower.osc.activate(
      new MouseEvent('mouseup', { altKey: true }),
      'https://example.com',
      {} as never,
    );
    expect(t.opener.open).not.toHaveBeenCalled();
  });

  it('shows the link menu on a right click and keeps that click from the CLI', () => {
    const t = setup();
    t.hover('https://example.com');
    t.fire('mousedown', { button: 2 });
    const menu = t.fire('contextmenu', { button: 2, clientX: 40, clientY: 60 });
    expect(t.reported).not.toHaveBeenCalled();
    expect(menu.defaultPrevented).toBe(true);
    expect(t.opener.menu).toHaveBeenCalledExactlyOnceWith('https://example.com', { x: 40, y: 60 });
  });

  it('lets the right click through when the link has no menu', () => {
    const t = setup();
    t.opener.menu.mockReturnValue(false);
    t.hover('file:///etc/hosts');
    const menu = t.fire('contextmenu', { button: 2 });
    expect(menu.defaultPrevented).toBe(false);
    expect(t.reported).toHaveBeenCalledTimes(1);
  });

  it('does not swallow a click when the CLI is not reading the mouse', () => {
    const t = setup('none');
    t.hover('https://example.com');
    t.fire('mousedown');
    expect(t.reported).toHaveBeenCalledTimes(1);
  });

  it('stops following when the terminal is disposed', () => {
    const t = setup();
    t.hover('https://example.com');
    t.stop();
    t.fire('mousedown');
    expect(t.reported).toHaveBeenCalledTimes(1);
  });
});
