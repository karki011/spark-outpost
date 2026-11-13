// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeetingDetail } from '@spark-outpost/contracts';
import { MeetingPage } from './MeetingPage.tsx';
import {
  MEETING_ID,
  detail,
  lines,
  mockFetch,
  newClient,
  type Call,
} from './meetings-test-support.tsx';

vi.mock('./MeetingAsk.tsx', () => ({ MeetingAsk: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(onStartChat = vi.fn(), onDeleted = vi.fn()) {
  const client = newClient();
  render(
    <QueryClientProvider client={client}>
      <MeetingPage id={MEETING_ID} onStartChat={onStartChat} onDeleted={onDeleted} />
    </QueryClientProvider>,
  );
  return { client, onStartChat, onDeleted };
}

function refetch(client: ReturnType<typeof newClient>) {
  return act(() => client.invalidateQueries({ queryKey: ['meetings'] }));
}

describe('Meeting page', () => {
  it('shows the notes, then You and Others lines in the transcript', async () => {
    mockFetch(({ path }) => {
      if (path === `/meetings/${MEETING_ID}`) return detail({ lineCount: 2 }, 'Decided: ship it');
      if (path.includes('/lines')) return { lines: lines(1, 2), more: false };
    });
    show();
    expect(await screen.findByText('Decided: ship it')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Transcript/ }));
    const list = await screen.findByRole('list', { name: 'Transcript' });
    const items = list.querySelectorAll('li');
    expect(items[0]?.textContent).toContain('You');
    expect(items[0]?.textContent).toContain('0:01');
    expect(items[0]?.textContent).toContain('line 1');
    expect(items[1]?.textContent).toContain('Others');
  });

  it('adds only the new lines while recording and keeps the earlier ones', async () => {
    let current: MeetingDetail = detail(
      { state: 'recording', endedAt: null, lineCount: 3, notesState: 'none' },
      null,
    );
    const calls = mockFetch(({ path }) => {
      if (path === `/meetings/${MEETING_ID}`) return current;
      if (path.endsWith('lines?tail=1')) return { lines: lines(1, 3), more: false };
      if (path.endsWith('lines?after=3&limit=200')) return { lines: lines(4, 5), more: false };
    });
    const { client } = show();
    fireEvent.click(await screen.findByRole('tab', { name: /Transcript/ }));
    await screen.findByText('line 3');
    current = detail({ state: 'recording', endedAt: null, lineCount: 5, notesState: 'none' }, null);
    await refetch(client);
    expect(await screen.findByText('line 5')).toBeTruthy();
    expect(screen.getByText('line 1')).toBeTruthy();
    const lineCalls = calls.filter((call) => call.path.includes('/lines')).map((call) => call.path);
    expect(lineCalls).toEqual([
      `/meetings/${MEETING_ID}/lines?tail=1`,
      `/meetings/${MEETING_ID}/lines?after=3&limit=200`,
    ]);
  });

  it('keeps what the user typed when a refetch lands, then saves it', async () => {
    let server = detail({}, 'Notes');
    const calls = mockFetch((call: Call) => {
      if (call.path !== `/meetings/${MEETING_ID}`) return undefined;
      if (call.method === 'PATCH') {
        const patch = call.body as { userNotes?: string };
        server = detail({ userNotes: patch.userNotes ?? '' }, 'Notes');
      }
      return server;
    });
    const { client } = show();
    fireEvent.click(await screen.findByRole('tab', { name: /Context/ }));
    const box = (await screen.findByLabelText('Your notes')) as HTMLTextAreaElement;
    box.focus();
    fireEvent.change(box, { target: { value: 'ask about the discount' } });
    await refetch(client);
    expect(box.value).toBe('ask about the discount');
    expect(document.activeElement).toBe(box);
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true), {
      timeout: 3000,
    });
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      userNotes: 'ask about the discount',
    });
    await waitFor(() => expect(box.value).toBe('ask about the discount'));
  });

  it('shows why notes failed and writes them again on request', async () => {
    const calls = mockFetch(({ path }) => {
      if (path === `/meetings/${MEETING_ID}`) {
        return detail(
          { notesState: 'failed', notesNote: 'Connect a provider to write notes.' },
          null,
        );
      }
      if (path.endsWith('/notes/write')) return null;
    });
    show();
    expect(await screen.findByText(/Connect a provider to write notes\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Write again' }));
    await waitFor(() =>
      expect(
        calls.some((call) => call.method === 'POST' && call.path.endsWith('/notes/write')),
      ).toBe(true),
    );
  });

  it('opens on the transcript while recording and on the notes once it has ended', async () => {
    let current: MeetingDetail = detail(
      { state: 'recording', endedAt: null, lineCount: 2, notesState: 'none' },
      null,
    );
    mockFetch(({ path }) => {
      if (path === `/meetings/${MEETING_ID}`) return current;
      if (path.includes('/lines')) return { lines: lines(1, 2), more: false };
    });
    const { client } = show();
    const transcript = await screen.findByRole('tab', { name: /Transcript/ });
    expect(transcript.getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('line 2')).toBeTruthy();
    current = detail({ lineCount: 2, notesState: 'writing' }, null);
    await refetch(client);
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Notes' }).getAttribute('aria-selected')).toBe('true'),
    );
    expect(screen.getByRole('status').textContent).toContain('Writing notes…');
  });

  it('keeps the tab the user picked when the recording ends', async () => {
    let current: MeetingDetail = detail(
      { state: 'recording', endedAt: null, notesState: 'none' },
      null,
    );
    mockFetch(({ path }) => {
      if (path === `/meetings/${MEETING_ID}`) return current;
      if (path.includes('/lines')) return { lines: [], more: false };
    });
    const { client } = show();
    fireEvent.click(await screen.findByRole('tab', { name: /Context/ }));
    current = detail({ notesState: 'writing' }, null);
    await refetch(client);
    await waitFor(() => expect(screen.queryByText('Recording')).toBeNull());
    expect(screen.getByRole('tab', { name: /Context/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('asks in a dialog before deleting, with Cancel focused and Esc keeping the meeting', async () => {
    const calls = mockFetch(({ path, method }) => {
      if (method === 'DELETE') return null;
      if (path === `/meetings/${MEETING_ID}`) return detail({}, 'Notes');
    });
    const { onDeleted } = show();
    const open = await screen.findByRole('button', { name: 'Delete…' });
    fireEvent.click(open);
    const dialog = screen.getByRole('alertdialog', { name: 'Delete “Pricing review”?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(open);
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    fireEvent.click(open);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(open);
    fireEvent.click(screen.getByRole('button', { name: 'Delete meeting' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
  });

  it('hands the notes to Start a chat', async () => {
    mockFetch(({ path }) => {
      if (path === `/meetings/${MEETING_ID}`) return detail({}, 'Decided: ship it');
    });
    const { onStartChat } = show();
    fireEvent.click(await screen.findByRole('button', { name: 'Start a chat' }));
    expect(onStartChat).toHaveBeenCalledWith(
      expect.objectContaining({ id: MEETING_ID }),
      'Decided: ship it',
    );
  });
});
