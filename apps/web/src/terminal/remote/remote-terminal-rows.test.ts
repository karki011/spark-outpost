import { describe, expect, it } from 'vitest';
import type { TerminalTranscriptItem } from '@spark-outpost/contracts';
import { stepsLabel, transcriptRows } from './RemoteTerminalItems.tsx';

function item(id: string, kind: TerminalTranscriptItem['kind'], tool: string | null = null) {
  return { id, kind, text: '', tool, at: null, clipped: false } satisfies TerminalTranscriptItem;
}

describe('Terminal transcript rows on a paired device', () => {
  it('folds two or more tool steps in a row into one group and leaves a lone step alone', () => {
    const rows = transcriptRows([
      item('u1', 'user'),
      item('t1', 'tool', 'Bash'),
      item('a1', 'assistant'),
      item('t2', 'tool', 'Read'),
      item('t3', 'tool', 'Bash'),
      item('t4', 'tool', 'Edit'),
      item('a2', 'assistant'),
    ]);
    expect(
      rows.map((row) => (row.kind === 'steps' ? row.tools.map((t) => t.id) : row.item.id)),
    ).toEqual(['u1', 't1', 'a1', ['t2', 't3', 't4'], 'a2']);
  });

  it('names the count and the kinds of step, shortening a long list', () => {
    const tools = ['Bash', 'Read', 'Bash', 'Edit', 'Grep', 'Write'].map((tool, index) =>
      item(`t${index}`, 'tool', tool),
    );
    expect(stepsLabel(tools.slice(0, 3))).toBe('3 steps: Running a command, Reading a file');
    expect(stepsLabel(tools)).toMatch(/^6 steps: [^,]+, [^,]+, [^,]+, …$/);
  });
});
