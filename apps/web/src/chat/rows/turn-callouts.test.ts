import { describe, expect, it } from 'vitest';
import type { StepView } from '../run-projection.ts';
import { foldSummary } from './turn-fold.ts';
import { turnRowParts, type Row, type TurnRowPart } from './turn-rows.ts';

const done = (name: string, extra: Partial<StepView> = {}): StepView => ({
  name,
  status: 'done',
  ...extra,
});

const browserOpen = (status: StepView['status'] = 'done'): StepView => ({
  name: 'Opening a page in the browser',
  status,
  toolKind: 'other',
  toolName: 'mcp__spark__spark_browser_open',
  target: 'cloudzero.com',
});

const browserRead: StepView = done('Reading a page', {
  toolKind: 'other',
  toolName: 'mcp__spark__spark_browser_read',
});

const reads = (...files: string[]) =>
  files.map((file) => done(`Read \`${file}\``, { toolKind: 'read', target: file }));

function rowsOf(steps: StepView[]): Row[] {
  return turnRowParts({ text: '', steps, commands: [] }).flatMap((part: TurnRowPart) =>
    part.kind === 'rows' ? part.rows : [],
  );
}

function shape(rows: readonly Row[]): string[] {
  return rows.map((row) => {
    if (row.kind === 'group') return `group:${row.items.length}${row.live ? '+live' : ''}`;
    if (row.kind === 'tool' && row.callout) {
      return `callout:${row.verb}${row.target ? ` ${row.target}` : ''}`;
    }
    return row.kind;
  });
}

describe('step callouts in the turn rows', () => {
  it('splits the fold so the groups before and after a callout keep their order', () => {
    const rows = rowsOf([
      ...reads('a.ts', 'b.ts'),
      browserOpen(),
      ...reads('c.ts', 'd.ts', 'e.ts'),
    ]);
    expect(shape(rows)).toEqual(['group:2', 'callout:Opened cloudzero.com', 'group:3']);
  });

  it('keeps adjacent callouts as rows of their own, in order', () => {
    const artifact = done('Making an artifact', {
      toolKind: 'other',
      toolName: 'mcp__spark__spark_artifact',
      target: 'publish Spend report',
    });
    const rows = rowsOf([browserOpen(), browserRead, artifact]);
    expect(shape(rows)).toEqual([
      'callout:Opened cloudzero.com',
      'callout:Read the page',
      'callout:Made a page: Spend report',
    ]);
  });

  it('shows a running callout as its own live row, never in the group head', () => {
    const rows = rowsOf([...reads('a.ts', 'b.ts'), browserOpen('open')]);
    expect(shape(rows)).toEqual(['group:2', 'callout:Opening cloudzero.com']);
    expect(rows[1]).toMatchObject({ status: 'open', callout: { kind: 'browser' } });
    const plain = rowsOf([...reads('a.ts', 'b.ts'), { name: 'Read `c.ts`', status: 'open' }]);
    expect(shape(plain)).toEqual(['group:2+live']);
  });

  it('calls out Codex Spark tools and a Codex web search with no tool name', () => {
    const mac = done('Acting in a Mac app', {
      toolKind: 'other',
      toolName: 'mcp.spark.spark_mac_act',
      target: 'menu Notes › File › Save',
    });
    const search = done('Searched the web', { toolKind: 'search', target: 'react 20' });
    expect(shape(rowsOf([mac, search]))).toEqual([
      'callout:Chose File › Save in Notes',
      'callout:Searched the web for react 20',
    ]);
  });

  it('leaves commands, reads, edits and other tools folded', () => {
    const rows = rowsOf([
      ...reads('a.ts'),
      done('`pnpm test`', { toolKind: 'execute', toolName: 'Bash' }),
      done('Reading the user guide', { toolKind: 'other', toolName: 'mcp__spark__spark_docs' }),
      done('Using create issue (github)', {
        toolKind: 'other',
        toolName: 'mcp__github__create_issue',
      }),
      done('Listing Mac apps', { toolKind: 'other', toolName: 'mcp__spark__spark_mac_apps' }),
    ]);
    expect(shape(rows)).toEqual(['group:5']);
  });

  it('counts callouts by their kind in the finished-turn summary', () => {
    const parts = turnRowParts({
      text: 'Done.',
      steps: [
        ...reads('a.ts', 'b.ts'),
        browserOpen(),
        browserRead,
        done('Fetched example.com', { toolKind: 'fetch', toolName: 'WebFetch' }),
      ],
      commands: [],
    });
    expect(foldSummary(parts)).toBe('read 2 files, used the browser 2 times, used the web once');
  });
});
