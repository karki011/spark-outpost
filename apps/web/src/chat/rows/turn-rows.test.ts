import { describe, expect, it } from 'vitest';
import type { CommandView } from '../commands/command-model.ts';
import type { StepView } from '../run-projection.ts';
import { groupSeconds, groupSummary } from './group-summary.ts';
import { spanSeconds, turnRowParts, type Row, type TurnRowPart } from './turn-rows.ts';

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
    if (group.kind === 'group') expect(groupSummary(group)).toBe('Read 2 files, searched once');
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

  it('hides the allowed notes earlier runs stored between commands', () => {
    const parts = turnRowParts({
      text: '',
      steps: [
        done('Allowed `pnpm a` (Bypass permissions mode)'),
        done('Allowed `pnpm b` (on the project allowlist)'),
      ],
      commands: [command('a', 'completed', 0), command('b', 'completed', 10)],
    });
    expect(kinds(parts)).toEqual(['rows:group']);
  });

  it('lets thoughts join a group and counts them', () => {
    const think = (id: string) => done('Thinking', { reasoningId: id });
    const parts = turnRowParts({
      text: '',
      steps: [think('r1'), done('Read `a.ts`'), think('r2'), done('Read `b.ts`')],
      commands: [],
    });
    expect(kinds(parts)).toEqual(['rows:group']);
    const group = rowsOf(parts)[0]![0]!;
    if (group.kind === 'group') {
      expect(group.items.map((item) => item.kind)).toEqual(['thought', 'tool', 'thought', 'tool']);
      expect(groupSummary(group)).toBe('Read 2 files, thought 2 times');
    }
  });

  it('keeps a lone step and its thought as rows', () => {
    const parts = turnRowParts({
      text: '',
      steps: [done('Thinking', { reasoningId: 'r1' }), done('Read `a.ts`')],
      commands: [],
    });
    expect(kinds(parts)).toEqual(['rows:thought,tool']);
  });

  it('words a mixed group by kind, commands first', () => {
    const parts = turnRowParts({
      text: '',
      steps: [
        done('Read `a.ts`'),
        done('Edit `a.ts`'),
        done('Search for `x`'),
        done('Thinking', { reasoningId: 'r1' }),
      ],
      commands: [command('a', 'completed', 0), command('b', 'completed', 10)],
    });
    const group = rowsOf(parts)[0]![0]!;
    expect(group.kind).toBe('group');
    if (group.kind === 'group') {
      expect(groupSummary(group)).toBe(
        'Ran 2 commands, edited 1 file, read 1 file, searched once, thought once',
      );
    }
  });

  it('shows a live step under the group it follows', () => {
    const parts = turnRowParts({
      text: '',
      steps: [done('Read `a.ts`'), done('Read `b.ts`'), { name: 'Thinking', status: 'open' }],
      commands: [],
    });
    const [rows] = rowsOf(parts);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ kind: 'group', live: { kind: 'thought' } });
  });

  it('leaves a finished web step after a group as its own row', () => {
    const fetch = { toolKind: 'fetch', toolName: 'WebFetch' };
    const parts = turnRowParts({
      text: '',
      steps: [done('Read `a.ts`'), done('Read `b.ts`'), done('Fetched example.com', fetch)],
      commands: [],
    });
    const [rows] = rowsOf(parts);
    expect(rows!.map((row) => row.kind)).toEqual(['group', 'tool']);
    expect(rows![0]).toMatchObject({ kind: 'group', live: null });
  });

  it('times a group across its commands and thoughts', () => {
    const parts = turnRowParts({
      text: '',
      steps: [done('Thinking', { reasoningId: 'r1', startedAt: 500, finishedAt: 900 })],
      commands: [command('a', 'completed', 0), command('b', 'completed', 4_000)],
    });
    const group = rowsOf(parts)[0]![0]!;
    if (group.kind === 'group') expect(groupSeconds(group)).toBe(6);
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
    expect(rows![0]).toMatchObject({ kind: 'group' });
    if (rows![0]!.kind === 'group') expect(groupSummary(rows![0]!)).toBe('Ran 2 commands');
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
      steps: [
        done('Read `a.ts`'),
        done('Read `b.ts`'),
        { name: 'Read `c.ts`', status: 'open' },
        done('Read `d.ts`'),
      ],
      commands: [],
    });
    expect(kinds(parts)).toEqual(['rows:group,tool,tool']);
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
    expect(group).toMatchObject({ kind: 'group' });
    if (group.kind !== 'group') return;
    expect(group.items[0]).toMatchObject({ target: 'My File.ts', path: '/repo/src/My File.ts' });
    expect(groupSummary(group)).toBe('Edited 2 files');
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
    if (group.kind === 'group') expect(groupSummary(group)).toBe('Read 2 files, searched 2 times');
  });
});
