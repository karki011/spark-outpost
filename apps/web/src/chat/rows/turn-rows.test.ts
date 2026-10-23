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

  it("shows a file step's name and keeps its whole path, counting each file once", () => {
    const edit = (path: string) => done('Edit', { toolKind: 'edit', target: path });
    const parts = turnRowParts({
      text: '',
      steps: [
        edit('/repo/src/My File.ts'),
        edit('/repo/tests/index.ts'),
        edit('/repo/src/My File.ts'),
      ],
      commands: [],
    });
    const [rows] = rowsOf(parts);
    const group = rows![0]!;
    expect(group).toMatchObject({ kind: 'group', family: 'edit' });
    if (group.kind !== 'group') return;
    expect(group.items[0]).toMatchObject({ target: 'My File.ts', path: '/repo/src/My File.ts' });
    expect(groupSummary(group)).toBe('2 files');
  });
});

function onlyRow(step: StepView) {
  const [rows] = rowsOf(turnRowParts({ text: '', steps: [step], commands: [] }));
  return rows![0];
}

describe('turn rows named by the ACP tool name', () => {
  it('shows the tool name as the verb and keeps the target from the title', () => {
    const file = { toolKind: 'read', target: 'cart.js', toolName: 'Read' };
    expect(onlyRow(done('Read `cart.js`', file))).toMatchObject({
      tone: 'read',
      verb: 'Read',
      target: 'cart.js',
    });
    const shell = { toolKind: 'execute', toolName: 'Bash' };
    expect(onlyRow(done('`git status`', shell))).toMatchObject({
      tone: 'run',
      verb: 'Bash',
      target: 'git status',
      label: 'git status',
    });
    const grep = { toolKind: 'search', toolName: 'Grep' };
    expect(onlyRow(done('Search for `total` in `src`', grep))).toMatchObject({
      tone: 'search',
      verb: 'Grep',
      target: 'for total in src',
    });
    const edit = { toolKind: 'edit', target: 'cart.js', toolName: 'Edit' };
    expect(onlyRow(done('Edit `cart.js`', edit))).toMatchObject({
      tone: 'edit',
      verb: 'Edit',
      target: 'cart.js',
    });
  });

  it('spells out web tools and drops a target that only restates the tool', () => {
    const search = { toolKind: 'fetch', toolName: 'WebSearch' };
    expect(onlyRow(done('Searched the web', search))).toMatchObject({
      tone: 'web',
      verb: 'Web search',
      target: null,
      label: 'Searched the web',
    });
    const fetch = { toolKind: 'fetch', toolName: 'WebFetch' };
    expect(onlyRow(done('Fetched example.com', fetch))).toMatchObject({
      verb: 'Web fetch',
      target: 'example.com',
    });
  });

  it('names MCP and Spark tools, and keeps a title that adds to the name', () => {
    const mcp = { toolKind: 'other', toolName: 'mcp__github__create_issue' };
    expect(onlyRow(done('Using create issue (github)', mcp))).toMatchObject({
      verb: 'github · create_issue',
      target: null,
      label: 'Using create issue (github)',
    });
    const spark = { toolKind: 'other', toolName: 'mcp__spark__spark_docs' };
    expect(onlyRow(done('Reading the user guide', spark))).toMatchObject({
      verb: 'Reading the user guide',
      target: null,
    });
    const agent = { toolKind: 'think', toolName: 'Agent' };
    expect(onlyRow(done('Explore the repo', agent))).toMatchObject({
      verb: 'Agent',
      target: 'Explore the repo',
    });
  });

  it("keeps today's row when the name is missing or hides the action", () => {
    const read = { toolKind: 'read', target: 'a.ts' };
    expect(onlyRow(done('Read `a.ts`', read))).toMatchObject({ verb: 'Read', target: 'a.ts' });
    const codexRead = { ...read, toolName: 'exec_command' };
    expect(onlyRow(done("Read file 'a.ts'", codexRead))).toMatchObject({
      tone: 'read',
      verb: 'Read',
      target: 'a.ts',
    });
    const codexRun = { toolKind: 'execute', toolName: 'exec_command' };
    expect(onlyRow(done('`ls`', codexRun))).toMatchObject({ verb: 'Ran', target: 'ls' });
  });

  it('counts files and searches in a group by tool name', () => {
    const parts = turnRowParts({
      text: '',
      steps: [
        done('Read `a.ts`', { toolKind: 'read', target: 'a.ts', toolName: 'Read' }),
        done('Find `src` `**/*.ts`', { toolKind: 'search', toolName: 'Glob' }),
        done('Search for `x`', { toolKind: 'search', toolName: 'Grep' }),
        done('View Image `b.png`', { toolKind: 'read', target: 'b.png', toolName: 'view_image' }),
      ],
      commands: [],
    });
    const group = rowsOf(parts)[0]![0]!;
    expect(group.kind).toBe('group');
    if (group.kind === 'group') expect(groupSummary(group)).toBe('2 files, 2 searches');
  });
});
