import { describe, expect, it } from 'vitest';
import type { ChangeRunSummary } from '@spark-outpost/contracts';
import { offersRevert } from './revert-offer.ts';

const RUN = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

function changed(runId: string, files: number, revertedAt: string | null = null): ChangeRunSummary {
  return { runId, files, added: files, removed: 0, revertedAt };
}

describe('offering Revert to before this run', () => {
  it('is not offered on a turn that changed nothing', () => {
    expect(offersRevert({ revertedAt: null }, [], [RUN])).toBe(false);
    expect(offersRevert({ revertedAt: null }, [changed(RUN, 0)], [RUN])).toBe(false);
  });

  it('is not offered because another turn of the task changed files', () => {
    expect(offersRevert({ revertedAt: null }, [changed(OTHER, 2)], [RUN])).toBe(false);
  });

  it('is offered on a turn that changed files', () => {
    expect(offersRevert({ revertedAt: null }, [changed(RUN, 1)], [RUN])).toBe(true);
  });

  it('keeps the reverted line of a turn that was reverted', () => {
    expect(offersRevert({ revertedAt: '2026-10-10T10:00:00.000Z' }, [], [RUN])).toBe(true);
  });
});
