import { describe, expect, it } from 'vitest';
import type { PieceList, TaskPiece } from '@spark-outpost/contracts';
import { commandDir, insideTree, redirectWrites, type EditEvidence } from './edit-evidence.ts';
import { checkOwnership } from './ownership.ts';
import type { Coordination } from './state.ts';

function piece(key: string): TaskPiece {
  return { key, research: false } as TaskPiece;
}

function coordination(): Coordination {
  const pieces = ['P1', 'P2', 'P3'].map(piece);
  return {
    list: { pieces } as PieceList,
    owned: new Map([
      ['P1', { paths: ['store.ts'], globs: [] }],
      ['P2', { paths: ['api.ts'], globs: [] }],
      ['P3', { paths: ['view.ts'], globs: [] }],
    ]),
    names: new Map([
      ['P1', 'Bolt'],
      ['P2', 'Rivet'],
      ['P3', 'Tack'],
    ]),
    crossed: new Set<string>(),
  } as unknown as Coordination;
}

const evidence = (mine: string[], others: string[] = []): EditEvidence => ({
  mine: new Set(mine),
  others: new Set(others),
});
const idle = () => true;
const running = () => false;

describe('who changed a file another piece owns', () => {
  it('flags the worker whose own tool call edited it, even while the owner runs', () => {
    const state = coordination();
    expect(checkOwnership(state, piece('P1'), ['api.ts'], running, evidence(['api.ts']))).toEqual([
      { path: 'api.ts', action: 'kept', owner: 'Rivet (P2)' },
    ]);
    expect(checkOwnership(state, piece('P1'), ['api.ts'], running, evidence(['api.ts']))).toEqual(
      [],
    );
  });

  it('leaves a running owner’s file alone when nothing shows this worker changed it', () => {
    expect(checkOwnership(coordination(), piece('P1'), ['api.ts'], running, evidence([]))).toEqual(
      [],
    );
  });

  it('names the worker that edited it, not the one whose turn ended first', () => {
    const state = coordination();
    expect(
      checkOwnership(state, piece('P1'), ['view.ts'], idle, evidence([], ['view.ts'])),
    ).toEqual([]);
    expect(checkOwnership(state, piece('P2'), ['view.ts'], idle, evidence(['view.ts']))).toEqual([
      { path: 'view.ts', action: 'kept', owner: 'Tack (P3)' },
    ]);
  });

  it('still flags an unobserved write once when the owner cannot have made it', () => {
    const state = coordination();
    expect(checkOwnership(state, piece('P1'), ['view.ts'], idle, evidence([]))).toHaveLength(1);
    expect(checkOwnership(state, piece('P2'), ['view.ts'], idle, evidence([]))).toEqual([]);
  });
});

describe('paths a run wrote', () => {
  it('places absolute and relative paths inside the tree, through a linked folder too', () => {
    const bases = ['/tmp/repo', '/private/tmp/repo'];
    expect(insideTree(bases, '/tmp/repo', '/private/tmp/repo/src/a.ts')).toBe('src/a.ts');
    expect(insideTree(bases, '/tmp/repo/src', 'a.ts')).toBe('src/a.ts');
    expect(insideTree(bases, '/tmp/repo', '/dev/null')).toBeNull();
    expect(insideTree(bases, '/tmp/repo', '../other/a.ts')).toBeNull();
  });

  it('reads the files a command redirects into', async () => {
    expect(await redirectWrites('echo hi > api.ts && cat x >> notes/log.txt', '/t')).toEqual([
      '/t/api.ts',
      '/t/notes/log.txt',
    ]);
    expect(await redirectWrites('cat < input.txt; echo "$X" > "$OUT"', '/t')).toEqual([]);
  });

  const tree = '/work/chat-tree';

  it('reads a stored command folder as a place in the run\u2019s tree, not the server\u2019s folder', () => {
    expect(commandDir('./', tree)).toBe(tree);
    expect(commandDir('./packages/api', tree)).toBe(`${tree}/packages/api`);
    expect(commandDir(null, tree)).toBe(tree);
    expect(commandDir('/elsewhere/repo', tree)).toBe('/elsewhere/repo');
  });

  it('places a redirect from a command Claude reports with no folder inside the tree', async () => {
    const from = commandDir('./', tree);
    const written = await redirectWrites('echo "// tiny-utils test" >> test/csv.test.ts', from);
    expect(written.map((target) => insideTree([tree], tree, target))).toEqual(['test/csv.test.ts']);
  });

  it('follows a leading cd before the redirect', async () => {
    expect(
      await redirectWrites(`cd "${tree}/packages/api" && echo x >> src/routes.ts`, '/somewhere'),
    ).toEqual([`${tree}/packages/api/src/routes.ts`]);
    expect(await redirectWrites('cd packages/api && echo x > notes.md', tree)).toEqual([
      `${tree}/packages/api/notes.md`,
    ]);
    expect(await redirectWrites('cd "$DIR" && echo x > notes.md', tree)).toEqual([]);
  });
});
