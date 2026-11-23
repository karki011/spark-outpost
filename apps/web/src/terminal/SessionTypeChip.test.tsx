// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionTypeChip } from './SessionTypeChip.tsx';

vi.mock('../phone/use-remote-client.ts', () => ({ useRemoteClient: () => ({ remote: false }) }));

function onDesktop(platform: string): void {
  vi.stubGlobal('sparkDesktop', { platform });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openMenu(onChange = vi.fn()) {
  render(
    <SessionTypeChip
      value={{ sessionType: 'chat', terminalProvider: 'claude' }}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Session type: Chat' }));
  return onChange;
}

describe('the session type chip', () => {
  it('offers Terminal sessions on the Mac', () => {
    onDesktop('darwin');
    const onChange = openMenu();
    const terminal = screen.getByRole('menuitemradio', { name: /Terminal/ });
    expect(terminal).toHaveProperty('disabled', false);
    fireEvent.click(terminal);
    expect(onChange).toHaveBeenCalledWith({ sessionType: 'terminal', terminalProvider: 'claude' });
  });

  it('says Terminal sessions are coming to Windows and can’t be chosen there', () => {
    onDesktop('win32');
    const onChange = openMenu();
    const terminal = screen.getByRole('menuitemradio', { name: /Terminal/ });
    expect(terminal).toHaveProperty('disabled', true);
    expect(terminal.textContent).toContain('Coming to Windows');
    fireEvent.click(terminal);
    expect(onChange).not.toHaveBeenCalled();
  });
});
