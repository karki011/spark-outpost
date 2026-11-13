// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetingsTab } from './MeetingsTab.tsx';
import { detail, item, mockFetch, newClient, MEETING_ID } from './meetings-test-support.tsx';

vi.mock('./MeetingAsk.tsx', () => ({ MeetingAsk: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Host() {
  const [openId, setOpenId] = useState<string | null>(null);
  return <MeetingsTab openId={openId} onOpen={setOpenId} onStartChat={() => undefined} />;
}

function show() {
  render(
    <QueryClientProvider client={newClient()}>
      <Host />
    </QueryClientProvider>,
  );
}

const status = { supported: true, available: true, reason: null, recordingId: null };

describe('Meetings tab', () => {
  it('shows one splash with how to start, and no list or search, when there are no meetings', async () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    mockFetch(({ path }) => {
      if (path === '/meetings/status') return status;
      if (path.startsWith('/meetings?')) return { items: [], nextBefore: null };
    });
    show();
    expect(await screen.findByRole('heading', { name: 'Scout’s all ears' })).toBeTruthy();
    expect(screen.getByText('Take notes')).toBeTruthy();
    expect(screen.getByText(/Audio never leaves this Mac/)).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'New meeting' })).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByText('Pick a meeting to see its notes and transcript.')).toBeNull();
  });

  it('labels the search box by what it searches and shows only Search in it', async () => {
    mockFetch(({ path }) => {
      if (path === '/meetings/status') return status;
      if (path.startsWith('/meetings?') && path.includes('q=zzz')) {
        return { items: [], nextBefore: null };
      }
      if (path.startsWith('/meetings?')) return { items: [item()], nextBefore: null };
    });
    show();
    const box = (await screen.findByRole('searchbox', {
      name: 'Search meetings by title, notes and transcript',
    })) as HTMLInputElement;
    expect(box.placeholder).toBe('Search');
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(await screen.findByText('No meetings match “zzz”.')).toBeTruthy();
    expect(screen.getByRole('searchbox')).toBeTruthy();
  });

  it('lists a recording row first and says the notes state in words', async () => {
    const other = '33333333-3333-4333-8333-333333333333';
    mockFetch(({ path }) => {
      if (path === '/meetings/status') return status;
      if (path.startsWith('/meetings?')) {
        return {
          items: [
            item({
              id: MEETING_ID,
              title: 'Standup',
              state: 'recording',
              endedAt: null,
              notesState: 'none',
            }),
            item({ id: other, title: 'Retro', notesState: 'writing' }),
            item({
              id: '44444444-4444-4444-8444-444444444444',
              title: 'Sync',
              notesState: 'failed',
            }),
            item({
              id: '55555555-5555-4555-8555-555555555555',
              title: 'Planning',
              notesState: 'none',
            }),
            item({
              id: '66666666-6666-4666-8666-666666666666',
              title: 'Demo',
              notesState: 'ready',
              source: 'calendar',
              calendarName: 'Work',
            }),
          ],
          nextBefore: '2026-11-01T00:00:00.000Z',
        };
      }
    });
    show();
    const list = await screen.findByRole('list', { name: 'Meetings' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(within(rows[0]!).getByText('Recording')).toBeTruthy();
    expect(within(rows[1]!).getByText('Writing notes…')).toBeTruthy();
    expect(within(rows[2]!).getByText('Notes failed')).toBeTruthy();
    expect(within(rows[3]!).getByText('No notes')).toBeTruthy();
    expect(within(rows[4]!).getByText('Notes')).toBeTruthy();
    expect(within(rows[4]!).getByText(/Work/)).toBeTruthy();
    expect(within(rows[3]!).getByText(/Started by you/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
  });

  it('shows matching snippets under a row while searching', async () => {
    const calls = mockFetch(({ path }) => {
      if (path === '/meetings/status') return status;
      if (path.startsWith('/meetings?') && path.includes('q=pricing')) {
        return {
          items: [item({ title: 'Pricing review' }, ['we agreed on the pricing tiers'])],
          nextBefore: null,
        };
      }
      if (path.startsWith('/meetings?'))
        return { items: [item({ title: 'Pricing review' })], nextBefore: null };
    });
    show();
    await screen.findByRole('list', { name: 'Meetings' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pricing' } });
    expect(await screen.findByText('we agreed on the pricing tiers')).toBeTruthy();
    expect(calls.some((call) => call.path.includes('q=pricing'))).toBe(true);
  });

  it('opens a meeting beside the list with its notes', async () => {
    mockFetch(({ path }) => {
      if (path === '/meetings/status') return status;
      if (path.startsWith('/meetings?')) return { items: [item()], nextBefore: null };
      if (path === `/meetings/${MEETING_ID}`) return detail({}, 'Decided: ship it');
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Pricing review/ }));
    expect(await screen.findByText('Decided: ship it')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Pick a meeting to see its notes and transcript.')).toBeTruthy();
  });
});
