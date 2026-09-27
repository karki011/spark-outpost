import { describe, expect, it } from 'vitest';
import type { Orchestration } from '@spark-outpost/contracts';
import { whyLines } from './why-lines.ts';

const decision = (kind: string, childRunId: string | null, answer: Record<string, unknown>) => ({
  kind,
  childRunId,
  answer,
});

describe('why lines', () => {
  it('lists each route decision’s reason, named by crew member', () => {
    const orchestration = {
      crew: [{ runId: 'r1', name: 'Sketch' }],
      decisions: [
        decision('intake', null, { why: 'ignored' }),
        decision('route', 'r1', { why: 'Why Opus 5.5: rule top tier · top tier' }),
        decision('route', 'r2', { why: 'Why 6 Sol: Jev 0.91 · mid tier' }),
        decision('route', 'r3', {}),
      ],
    } as unknown as Orchestration;
    expect(whyLines(orchestration)).toEqual([
      'Sketch · Why Opus 5.5: rule top tier · top tier',
      'Why 6 Sol: Jev 0.91 · mid tier',
    ]);
  });
});
