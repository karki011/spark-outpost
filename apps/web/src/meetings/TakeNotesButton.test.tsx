// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TakeNotesButton } from './TakeNotesButton.tsx';
import { MEETING_ID, detail, mockFetch, newClient } from './meetings-test-support.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(onStarted = vi.fn()) {
  render(
    <QueryClientProvider client={newClient()}>
      <TakeNotesButton title="Pricing" eventKey="evt-1" calendarName="Work" onStarted={onStarted} />
    </QueryClientProvider>,
  );
  return onStarted;
}

describe('Take notes button', () => {
  it('renders nothing when recording is not available', async () => {
    const calls = mockFetch(({ path }) => {
      if (path === '/meetings/status') {
        return { available: false, reason: 'Needs the Mac app.', recordingId: null };
      }
    });
    const { container } = render(
      <QueryClientProvider client={newClient()}>
        <TakeNotesButton />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is disabled with the reason while another meeting records', async () => {
    const calls = mockFetch(({ path }) => {
      if (path === '/meetings/status') {
        return { available: true, reason: null, recordingId: MEETING_ID };
      }
    });
    show();
    const button = await screen.findByRole('button', { name: 'Take notes' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
    expect(
      document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toMatch(/Another meeting is recording/);
    fireEvent.click(button);
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('starts a meeting for the event and reports it', async () => {
    const calls = mockFetch(({ path, method }) => {
      if (path === '/meetings/status') return { available: true, reason: null, recordingId: null };
      if (path === '/meetings' && method === 'POST') return detail({ state: 'recording' }, null);
    });
    const onStarted = show();
    fireEvent.click(await screen.findByRole('button', { name: 'Take notes' }));
    await waitFor(() =>
      expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ id: MEETING_ID })),
    );
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      title: 'Pricing',
      eventKey: 'evt-1',
      calendarName: 'Work',
    });
  });
});
