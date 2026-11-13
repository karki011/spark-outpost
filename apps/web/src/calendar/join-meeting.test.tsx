// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detail, mockFetch, newClient, MEETING_ID } from '../meetings/meetings-test-support.tsx';
import { JoinButton } from './JoinButton.tsx';
import { at, event, link, status } from './test-fixtures.ts';
import { useTodayEventRequests, type TodayEventRequest } from './today-request.ts';

const opened = vi.fn();

beforeEach(() => {
  vi.stubGlobal('open', opened);
});

afterEach(() => {
  cleanup();
  opened.mockReset();
  vi.unstubAllGlobals();
});

const standup = event('Standup', at(10), at(10, 30), { link: link('zoom') });

function Requests({ seen }: { seen: (request: TodayEventRequest) => void }) {
  useTodayEventRequests(seen);
  return null;
}

function show(notes: boolean, started: unknown) {
  const seen = vi.fn();
  const calls = mockFetch(({ path }) => {
    if (path === '/calendar/status') return status();
    if (path === '/meetings/join-notes') return { detail: started };
  });
  render(
    <QueryClientProvider client={newClient()}>
      <Requests seen={seen} />
      <JoinButton event={standup} now={at(10, 1)} notes={notes} calendarName="Work" />
    </QueryClientProvider>,
  );
  return { calls, seen };
}

describe('Join with Take notes when I join', () => {
  it('opens the link and asks the Mac to record, then opens the transcript when it started', async () => {
    const { calls, seen } = show(true, detail({ state: 'recording', endedAt: null }, null));
    fireEvent.click(screen.getByRole('button', { name: 'Join Standup' }));
    expect(opened).toHaveBeenCalledWith(
      'https://acme.zoom.us/j/1',
      expect.anything(),
      expect.anything(),
    );
    await waitFor(() =>
      expect(seen).toHaveBeenCalledWith(expect.objectContaining({ meetingId: MEETING_ID })),
    );
    expect(calls.find((call) => call.path === '/meetings/join-notes')?.body).toEqual({
      eventKey: standup.key,
      title: 'Standup',
      calendarName: 'Work',
    });
  });

  it('opens the link and nothing else when the setting is off on the Mac', async () => {
    const { calls, seen } = show(true, null);
    fireEvent.click(screen.getByRole('button', { name: 'Join Standup' }));
    await waitFor(() =>
      expect(calls.some((call) => call.path === '/meetings/join-notes')).toBe(true),
    );
    expect(opened).toHaveBeenCalledTimes(1);
    expect(seen).not.toHaveBeenCalled();
  });

  it('never asks to record from a Join outside Spark’s own window', () => {
    const { calls } = show(false, null);
    fireEvent.click(screen.getByRole('button', { name: 'Join Standup' }));
    expect(opened).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.path === '/meetings/join-notes')).toBe(false);
  });
});
