import { describe, expect, it } from 'vitest';
import type { BrowserShot, ChangeSummary } from '@spark-outpost/contracts';
import { browserCheckOf, keptChanges } from './browser-check.ts';

const RUN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const shot = (id: string): BrowserShot => ({
  id,
  runId: RUN,
  turnRunId: RUN,
  page: 'http://localhost:5173/',
  title: 'Home',
  width: 800,
  height: 600,
  createdAt: '2026-10-04T10:00:00.000Z',
  attachment: { id, name: 'browser.png', mediaType: 'image/png', size: 10, kind: 'image' },
});

const facts = {
  shots: [] as BrowserShot[],
  request: 'Make the Save button wider',
  changed: { any: true, files: ['src/settings/Save.tsx'] },
  paneAvailable: true,
};

describe('the browser check on a finished turn', () => {
  it('is checked, with the latest screenshot, when the agent took one', () => {
    const first = shot('33333333-3333-4333-8333-333333333333');
    const last = shot('44444444-4444-4444-8444-444444444444');
    expect(browserCheckOf({ ...facts, shots: [first, last] })).toEqual({
      state: 'checked',
      shot: last,
    });
    expect(
      browserCheckOf({
        ...facts,
        shots: [first],
        changed: { any: false, files: [] },
        paneAvailable: false,
      }),
    ).toEqual({ state: 'checked', shot: first });
  });

  it('is not checked when interface files changed and no screenshot was taken', () => {
    expect(browserCheckOf(facts)).toEqual({ state: 'not_checked' });
    expect(
      browserCheckOf({
        ...facts,
        request: 'Fix the retry count',
        changed: { any: true, files: ['src/app.css'] },
      }),
    ).toEqual({ state: 'not_checked' });
  });

  it('says nothing for other work, a turn that changed nothing, or without the Browser pane', () => {
    expect(
      browserCheckOf({
        ...facts,
        request: 'Fix the retry count',
        changed: { any: true, files: ['src/queue.ts'] },
      }),
    ).toBeNull();
    expect(browserCheckOf({ ...facts, changed: { any: false, files: [] } })).toBeNull();
    expect(browserCheckOf({ ...facts, changed: { any: true, files: [] } })).toEqual({
      state: 'not_checked',
    });
    expect(browserCheckOf({ ...facts, paneAvailable: false })).toBeNull();
  });
});

describe('the files a turn kept', () => {
  const summary: ChangeSummary = {
    version: 'v1',
    files: 3,
    added: 3,
    removed: 0,
    runs: [
      { runId: RUN, revertedAt: null, files: 2, added: 2, removed: 0 },
      { runId: OTHER, revertedAt: '2026-10-04T10:00:00.000Z', files: 1, added: 1, removed: 0 },
    ],
    top: [
      { runId: RUN, path: 'src/app.css', change: 'modified', added: 1, removed: 0 },
      { runId: OTHER, path: 'src/Other.tsx', change: 'modified', added: 1, removed: 0 },
    ] as ChangeSummary['top'],
  };

  it('lists the files of the turn’s runs and leaves out reverted runs', () => {
    expect(keptChanges(summary, [RUN, OTHER])).toEqual({ any: true, files: ['src/app.css'] });
    expect(keptChanges(summary, [OTHER])).toEqual({ any: false, files: [] });
    expect(keptChanges(undefined, [RUN])).toEqual({ any: false, files: [] });
  });
});
