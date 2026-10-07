import { describe, expect, it } from 'vitest';
import type { PieceList, TaskPiece } from '@spark-outpost/contracts';
import { insideTree, redirectTargets, type EditEvidence } from './edit-evidence.ts';
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
    expect(await redirectTargets('echo hi > api.ts && cat x >> notes/log.txt')).toEqual([
      'api.ts',
      'notes/log.txt',
    ]);
    expect(await redirectTargets('cat < input.txt; echo "$X" > "$OUT"')).toEqual([]);
  });
});
