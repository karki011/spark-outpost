// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BusyEnterAction } from '@spark-outpost/contracts';
import { RemoteTerminalComposer } from './RemoteTerminalComposer.tsx';

const SECRET = 'use ghp_abcdefghijklmnopqrstuvwxyz0123 for the push';

afterEach(cleanup);

it.each([true, false])('keeps new typing after remote delivery settles (sent=%s)', async (sent) => {
  let finish!: (value: boolean) => void;
  render(
    <RemoteTerminalComposer
      blocked={null}
      working={false}
      preferred="now"
      error={null}
      onSend={() =>
        new Promise((resolve) => {
          finish = resolve;
        })
      }
      onStop={async () => undefined}
    />,
  );
  const box = screen.getByRole('textbox', { name: 'Message the agent' }) as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: 'First message' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  fireEvent.change(box, { target: { value: 'Next message' } });
  await act(async () => finish(sent));
  expect(box.value).toBe(sent ? 'Next message' : 'Next message\n\nFirst message');
});

it.each([
  ['First message', false],
  ['Next message\n\nFirst message', false],
  ['First message', true],
  ['Next message\n\nFirst message', true],
] as const)(
  'restores a failed send once beside matching new text %j (reject=%s)',
  async (typed, reject) => {
    let finish!: () => void;
    render(
      <StrictMode>
        <RemoteTerminalComposer
          blocked={null}
          working={false}
          preferred="now"
          error={null}
          onSend={() =>
            new Promise((resolve, fail) => {
              finish = () => (reject ? fail(new Error('Send failed')) : resolve(false));
            })
          }
          onStop={async () => undefined}
        />
      </StrictMode>,
    );
    const box = screen.getByRole('textbox', { name: 'Message the agent' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'First message' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.change(box, { target: { value: typed } });
    await act(async () => finish());
    expect(box.value).toBe(`${typed}\n\nFirst message`);
  },
);

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
