import { afterEach, describe, expect, it, vi } from 'vitest';
import { listPath, meetingsApi } from './meetings-api.ts';
import { MEETING_ID, detail, mockFetch } from './meetings-test-support.tsx';

afterEach(() => vi.unstubAllGlobals());

describe('meetings api', () => {
  it('builds list URLs with the page size, search text and cursor', () => {
    expect(listPath('', undefined)).toBe('/meetings?limit=50');
    expect(listPath('pricing plan', '2026-11-01T00:00:00.000Z')).toBe(
      '/meetings?limit=50&q=pricing+plan&before=2026-11-01T00%3A00%3A00.000Z',
    );
  });

  it('calls the line, notes and attachment routes with the right verbs', async () => {
    const attachmentId = '22222222-2222-4222-8222-222222222222';
    const calls = mockFetch(({ path, method }) => {
      if (path.includes('/lines')) return { lines: [], more: false };
      if (path.endsWith('/notes') && method === 'PUT') {
        return {
          markdown: 'x',
          writtenAt: '2026-11-10T10:45:00.000Z',
          editedAt: null,
          runId: null,
        };
      }
      if (path.endsWith('/notes/write')) return null;
      return detail();
    });
    await meetingsApi.linesTail(MEETING_ID);
    await meetingsApi.linesAfter(MEETING_ID, 400, 100);
    await meetingsApi.saveNotes(MEETING_ID, 'x', '2026-11-10T10:45:00.000Z');
    await meetingsApi.writeNotes(MEETING_ID);
    await meetingsApi.attach(MEETING_ID, attachmentId);
    await meetingsApi.detach(MEETING_ID, attachmentId);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET /meetings/${MEETING_ID}/lines?tail=1`,
      `GET /meetings/${MEETING_ID}/lines?after=400&limit=100`,
      `PUT /meetings/${MEETING_ID}/notes`,
      `POST /meetings/${MEETING_ID}/notes/write`,
      `POST /meetings/${MEETING_ID}/attachments`,
      `DELETE /meetings/${MEETING_ID}/attachments/${attachmentId}`,
    ]);
    expect(calls[2]?.body).toEqual({ markdown: 'x', base: '2026-11-10T10:45:00.000Z' });
    expect(calls[4]?.body).toEqual({ attachmentId });
  });
});
