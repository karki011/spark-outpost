// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEETING_ID, detail, mockFetch, newClient } from '../meetings/meetings-test-support.tsx';
import { IslandRecording } from './IslandRecording.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(variant: 'line' | 'row') {
  const onOpen = vi.fn();
  const calls = mockFetch(({ path }) => {
    if (path === `/meetings/${MEETING_ID}`) return detail({ title: 'Pricing sync' });
    if (path === `/meetings/${MEETING_ID}/stop`) return detail({ title: 'Pricing sync' });
  });
  render(
    <QueryClientProvider client={newClient()}>
      <IslandRecording id={MEETING_ID} variant={variant} onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return { onOpen, calls };
}

describe('the island while a meeting is being recorded', () => {
  it('says Recording with the meeting’s name, and its name opens the transcript', async () => {
    const { onOpen } = show('row');
    const region = screen.getByRole('region', { name: 'Recording' });
    expect(region.textContent).toContain('Recording');
    fireEvent.click(await screen.findByRole('button', { name: 'Pricing sync' }));
    expect(onOpen).toHaveBeenCalledWith(MEETING_ID);
  });

  it('offers Open transcript on the hover line', () => {
    const { onOpen } = show('line');
    fireEvent.click(screen.getByRole('button', { name: 'Open transcript' }));
    expect(onOpen).toHaveBeenCalledWith(MEETING_ID);
  });

  it('stops that meeting from Stop', async () => {
    const { calls } = show('row');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ path: `/meetings/${MEETING_ID}/stop`, method: 'POST' }),
      ),
    );
  });
});
