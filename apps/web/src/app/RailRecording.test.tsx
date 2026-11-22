// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEETING_ID, detail, mockFetch, newClient } from '../meetings/meetings-test-support.tsx';
import { RailRecording } from './RailRecording.tsx';

const openTodayMeeting = vi.hoisted(() => vi.fn());
vi.mock('../calendar/today-request.ts', () => ({ openTodayMeeting }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  openTodayMeeting.mockClear();
});

describe('the left bar while a meeting is being recorded', () => {
  it('shows Rec, names the meeting and opens its transcript', async () => {
    mockFetch(({ path }) => {
      if (path === `/meetings/${MEETING_ID}`) return detail({ title: 'Pricing sync' });
    });
    render(
      <QueryClientProvider client={newClient()}>
        <RailRecording id={MEETING_ID} />
      </QueryClientProvider>,
    );
    const button = await screen.findByRole('button', {
      name: 'Recording Pricing sync. Open transcript',
    });
    expect(button.textContent).toContain('Rec');
    fireEvent.click(button);
    expect(openTodayMeeting).toHaveBeenCalledWith(MEETING_ID);
  });
});
