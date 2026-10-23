import { describe, expect, it } from 'vitest';
import type { CommandView } from '../commands/command-model.ts';
import type { StepView } from '../run-projection.ts';
import {
  groupSummary,
  spanSeconds,
  turnRowParts,
  type Row,
  type TurnRowPart,
} from './turn-rows.ts';

const done = (name: string, extra: Partial<StepView> = {}): StepView => ({
  name,
  status: 'done',
  ...extra,
});

function command(id: string, status: CommandView['status'], at = 0): CommandView {
  return {
    id,
    runId: 'run',
    command: `pnpm ${id}`,
    cwd: null,
    live: true,
    startedAt: new Date(1_000 + at).toISOString(),
    textOffset: null,
    textBefore: null,
    textHeld: null,
    status,
    exitCode: status === 'failed' ? 1 : 0,
    finishedAt: new Date(2_000 + at).toISOString(),
    outputChars: 0,
    output: null,
    received: 0,
    appended: 0,
    epoch: 0,
  };
}

function rowsOf(parts: readonly TurnRowPart[]): Row[][] {
  return parts.flatMap((part) => (part.kind === 'rows' ? [part.rows] : []));
}

function kinds(parts: readonly TurnRowPart[]): string[] {
  return parts.map((part) =>
    part.kind === 'rows' ? `rows:${part.rows.map((row) => row.kind).join(',')}` : part.kind,
  );
}

describe('turn rows', () => {
  it('folds a run of reads and searches into one explored group', () => {
    const parts = turnRowParts({
      text: 'Done.',
      steps: [done('Read `a.ts`'), done('Read `b.ts`'), done('Search for `x` in `src`')],
      commands: [],
    });
    const [rows] = rowsOf(parts);
    expect(rows).toHaveLength(1);
    const group = rows![0]!;
    expect(group.kind).toBe('group');
    if (group.kind === 'group') expect(groupSummary(group)).toBe('2 files, 1 search');
  });

  it("hides Spark's own bookkeeping steps", () => {
    const parts = turnRowParts({
      text: '',
      steps: [
        done("Working on spark/x in this chat's worktree."),
        done('Writing up results'),
        done('Read `a.ts`'),
      ],
      commands: [],
    });
    const [rows] = rowsOf(parts);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ kind: 'tool', verb: 'Read', target: 'a.ts' });
  });

  it('shows thinking as its own row, never grouped', () => {
    const parts = turnRowParts({
      text: '',
      steps: [done('Thinking', { reasoningId: 'r1' }), done('Read `a.ts`'), done('Read `b.ts`')],
      commands: [],
    });
    expect(kinds(parts)).toEqual(['rows:thought,group']);
  });

  it('drops run steps that a command record covers', () => {
    const parts = turnRowParts({
      text: '',
      steps: [done('`pnpm test`')],
      commands: [command('test', 'completed')],
    });
    expect(kinds(parts)).toEqual(['rows:command']);
  });

  it('keeps a run step when no command record exists', () => {
    const parts = turnRowParts({ text: '', steps: [done('`pnpm test`')], commands: [] });
    const [rows] = rowsOf(parts);
    expect(rows![0]).toMatchObject({ kind: 'tool', tone: 'run', verb: 'Ran' });
  });

  it('groups two or more commands', () => {
    const parts = turnRowParts({
      text: '',
      steps: [],
      commands: [command('a', 'completed', 0), command('b', 'failed', 10)],
    });
    const [rows] = rowsOf(parts);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ kind: 'group', family: 'run' });
  });

  it('places anchored steps between prose and never folds prose into a group', () => {
    const text = 'First I look.\n\nThen I edit.';
    const parts = turnRowParts({
      text,
      steps: [
        done('Read `a.ts`', { textOffset: 15, textBefore: 'First I look.\n\n', textHeld: 0 }),
        done('Edit `a.ts`', { textOffset: text.length, textBefore: 'Then I edit.', textHeld: 0 }),
      ],
      commands: [],
    });
    expect(kinds(parts)).toEqual(['text', 'rows:tool', 'text', 'rows:tool']);
  });

  it('keeps old steps without anchors before the reply', () => {
    const parts = turnRowParts({ text: 'Reply.', steps: [done('Read `a.ts`')], commands: [] });
    expect(kinds(parts)).toEqual(['rows:tool', 'text']);
  });

  it('keeps a running step out of a group', () => {
    const parts = turnRowParts({
      text: '',
      steps: [done('Read `a.ts`'), done('Read `b.ts`'), { name: 'Read `c.ts`', status: 'open' }],
      commands: [],
    });
    expect(kinds(parts)).toEqual(['rows:group,tool']);
  });

  it('puts the to-do after the opening thought', () => {
    const parts = turnRowParts({
      text: 'Reply.',
      steps: [done('Thinking'), done('Read `a.ts`')],
      commands: [],
      todo: true,
    });
    expect(kinds(parts)).toEqual(['rows:thought,todo,tool', 'text']);
  });

  it('places the to-do even when the turn has no steps', () => {
    const parts = turnRowParts({ text: '', steps: [], commands: [], todo: true });
    expect(kinds(parts)).toEqual(['rows:todo']);
  });

  it('measures a span only when every time is known', () => {
    expect(spanSeconds([{ startedAt: 1_000, finishedAt: 5_000 }])).toBe(4);
    expect(spanSeconds([{ startedAt: 1_000 }])).toBeNull();
    expect(spanSeconds([{ startedAt: 1_000, finishedAt: 1_200 }])).toBeNull();
  });
});
