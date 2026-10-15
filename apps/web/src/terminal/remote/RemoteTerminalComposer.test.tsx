// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BusyEnterAction } from '@spark-outpost/contracts';
import { RemoteTerminalComposer } from './RemoteTerminalComposer.tsx';

const SECRET = 'use ghp_abcdefghijklmnopqrstuvwxyz0123 for the push';

afterEach(cleanup);

function show(preferred: BusyEnterAction) {
  const onSend = vi.fn(async () => true);
  render(
    <RemoteTerminalComposer
      blocked={null}
      working
      preferred={preferred}
      error={null}
      onSend={onSend}
      onStop={async () => undefined}
    />,
  );
  const box = screen.getByRole('textbox', { name: 'Message the agent' });
  fireEvent.change(box, { target: { value: SECRET } });
  return { onSend, box };
}

async function sendAnyway() {
  fireEvent.click(await screen.findByRole('button', { name: 'Send anyway' }));
}

describe('RemoteTerminalComposer secret warning', () => {
  it('keeps Send now when the message is sent anyway', async () => {
    const { onSend } = show('queue');
    fireEvent.click(screen.getByRole('button', { name: 'Choose message timing' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Send now/ }));
    expect(onSend).not.toHaveBeenCalled();
    await sendAnyway();
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(SECRET, true));
  });

  it('keeps Send now chosen by Enter when it is the preferred timing', async () => {
    const { onSend, box } = show('now');
    fireEvent.keyDown(box, { key: 'Enter' });
    await sendAnyway();
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(SECRET, true));
  });

  it('keeps Queue message when the message is sent anyway', async () => {
    const { onSend } = show('queue');
    fireEvent.click(screen.getByRole('button', { name: 'Queue message' }));
    await sendAnyway();
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(SECRET, false));
  });
});
