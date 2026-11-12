import { QueryClient } from '@tanstack/react-query';
import { vi } from 'vitest';
import type {
  Meeting,
  MeetingDetail,
  MeetingLine,
  MeetingListItem,
} from '@spark-outpost/contracts';

export const MEETING_ID = '11111111-1111-4111-8111-111111111111';

export function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    id: MEETING_ID,
    title: 'Pricing review',
    source: 'adhoc',
    eventKey: null,
    calendarName: null,
    startedAt: '2026-11-10T10:00:00.000Z',
    endedAt: '2026-11-10T10:42:00.000Z',
    state: 'ended',
    goal: '',
    userNotes: '',
    lineCount: 0,
    notesState: 'ready',
    notesNote: null,
    ...over,
  };
}

export function detail(
  over: Partial<Meeting> = {},
  markdown: string | null = '# Notes',
): MeetingDetail {
  return {
    meeting: meeting(over),
    notes: markdown
      ? { markdown, writtenAt: '2026-11-10T10:45:00.000Z', editedAt: null, runId: null }
      : null,
    attachments: [],
  };
}

export function item(over: Partial<Meeting> = {}, snippets: string[] = []): MeetingListItem {
  return { meeting: meeting(over), snippets };
}

export function lines(from: number, to: number): MeetingLine[] {
  return Array.from({ length: to - from + 1 }, (_, index) => {
    const seq = from + index;
    return {
      seq,
      speaker: seq % 2 === 1 ? 'you' : 'others',
      text: `line ${seq}`,
      startMs: seq * 1000,
      endMs: seq * 1000 + 800,
    };
  });
}

export interface Call {
  path: string;
  method: string;
  body: unknown;
}

export type Router = (call: Call) => unknown;

export function mockFetch(router: Router) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const call: Call = {
        path: url.replace(/^\/api/, ''),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      };
      calls.push(call);
      const result = router(call);
      const status = result === undefined ? 404 : 200;
      return Promise.resolve(
        new Response(
          result === undefined ? JSON.stringify({ error: 'Not found' }) : JSON.stringify(result),
          {
            status,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    }),
  );
  return calls;
}

export function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
