import { describe, expect, it } from 'vitest';
import { aftermath, blockedText, filesText, stoppedText } from './interruption-model.ts';

const run = { id: 'r1', status: 'outcome_unknown' as const, interruptionChoice: null };
const other = { id: 'r2', continuesRunId: null };

function detail(runs: object[], interruptionRunId: string | null = null) {
  return {
    runs,
    interruption: interruptionRunId
      ? { runId: interruptionRunId, stoppedAt: null, blocked: null }
      : null,
  } as unknown as Parameters<typeof aftermath>[1];
}

describe('aftermath', () => {
  it('is nothing for a run that was not interrupted', () => {
    expect(aftermath({ ...run, status: 'failed' }, detail([run]))).toBeNull();
  });

  it('is undecided while the card is offered', () => {
    expect(aftermath(run, detail([run], 'r1'))).toEqual({ kind: 'undecided' });
  });

  it('points at the run that continued it', () => {
    const continued = { id: 'r2', continuesRunId: 'r1' };
    expect(aftermath({ ...run, interruptionChoice: 'continue' }, detail([run, continued]))).toEqual(
      { kind: 'continued', runId: 'r2' },
    );
  });

  it('says the user started fresh, or that the chat moved on without a choice', () => {
    expect(aftermath({ ...run, interruptionChoice: 'fresh' }, detail([run]))).toEqual({
      kind: 'fresh',
    });
    expect(aftermath(run, detail([run, other]))).toEqual({ kind: 'moved_on' });
  });
});

describe('card text', () => {
  it('gives the time, and the day when it was not today', () => {
    const now = new Date(2026, 9, 5, 15, 0);
    const today = new Date(2026, 9, 5, 14, 14).toISOString();
    const yesterday = new Date(2026, 9, 4, 22, 5).toISOString();
    expect(stoppedText(today, now)).toMatch(/^Spark Outpost stopped at 2:14\s?PM while/);
    expect(stoppedText(yesterday, now)).toMatch(/stopped at 10:05\s?PM on Oct 4 while/);
    expect(stoppedText(null, now)).toBe('Spark Outpost stopped while this turn was running.');
  });

  it('counts the changed files once they are known, and says nothing without a snapshot', () => {
    const file = { path: 'a.ts', change: 'modified' } as never;
    expect(filesText(undefined)).toBeNull();
    expect(filesText({ files: [], revertible: false })).toBeNull();
    expect(filesText({ files: [], revertible: true })).toBe('No files changed so far.');
    expect(filesText({ files: [file], revertible: true })).toBe('1 file changed so far.');
    expect(filesText({ files: [file, file], revertible: false })).toBe('2 files changed so far.');
  });

  it('explains why a crew turn can only start fresh', () => {
    expect(blockedText({ blocked: null })).toBeNull();
    expect(blockedText({ blocked: 'crew' })).toContain("can't resume a crew part-way yet");
  });
});
