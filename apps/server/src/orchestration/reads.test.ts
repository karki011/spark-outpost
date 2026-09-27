import { describe, expect, it } from 'vitest';
import { countOutput, counted, isFileRead, readRecord, readTarget, rereadCount } from './reads.ts';

describe('file reads per crew member', () => {
  it('counts read tool calls by kind or title, not searches or edits', () => {
    expect(isFileRead('Read `dates.ts`', 'read')).toBe(true);
    expect(isFileRead('Read dates.ts', undefined)).toBe(true);
    expect(isFileRead('Run cat src/dates.ts', 'execute')).toBe(true);
    expect(isFileRead('sed -n 1,40p src/turns.ts', 'execute')).toBe(true);
    expect(isFileRead('Search formatDay', 'search')).toBe(false);
    expect(isFileRead('Write `dates.ts`', 'edit')).toBe(false);
    expect(isFileRead('Run pnpm test', 'execute')).toBe(false);
  });

  it('names the file a read touched', () => {
    expect(readTarget('Read `dates.ts`')).toBe('dates.ts');
    expect(readTarget('Read src/turns.ts')).toBe('turns.ts');
    expect(readTarget('Run cat src/a/b.ts')).toBe('b.ts');
  });

  it('counts tool calls and reads from the stream', () => {
    const total = counted();
    countOutput(total, { kind: 'step_started', name: 'Read `a.ts`', tool: true, toolKind: 'read' });
    countOutput(total, {
      kind: 'step_started',
      name: 'Write `a.ts`',
      tool: true,
      toolKind: 'edit',
    });
    countOutput(total, { kind: 'step_started', name: 'Thinking' });
    expect(total).toEqual({ value: 2, tools: ['Read `a.ts`', 'Write `a.ts`'], reads: ['a.ts'] });
  });

  it('counts re-reads of files the Architect already read and keeps the Builder’s own line', () => {
    expect(rereadCount(['dates.ts', 'extra.ts', 'dates.ts'], ['src/dates.ts'])).toBe(2);
    expect(
      readRecord(['dates.ts', 'extra.ts'], ['src/dates.ts'], 'src/extra.ts (a helper)'),
    ).toEqual({ fileReads: 2, rereads: 1, extraReads: 'src/extra.ts (a helper)' });
    expect(readRecord(['a.ts'], null, null)).toEqual({ fileReads: 1 });
  });
});
