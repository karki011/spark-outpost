import { describe, expect, it } from 'vitest';
import {
  criticalPathSaving,
  placePieces,
  sharedTreeBlocker,
  type PlaceablePiece,
  type PlacementFacts,
} from './placement.ts';

const FACTS: PlacementFacts = {
  git: true,
  repoBusy: false,
  destructive: false,
  skipsGate: false,
  wholeProjectChecks: false,
  splitWorthIt: null,
  sameFolder: null,
};

function piece(key: string, extra: Partial<PlaceablePiece> = {}): PlaceablePiece {
  return {
    key,
    owned: { paths: [`src/${key}.ts`], globs: [] },
    dependsOn: [],
    sizeEstimate: 50_000,
    size: 'M',
    research: false,
    ...extra,
  };
}

const TWO_LARGE = [
  piece('P1'),
  piece('P2'),
  piece('P3', { dependsOn: ['P1', 'P2'], sizeEstimate: 10_000 }),
];

describe('placePieces', () => {
  it('row 1: outside git everything runs in order', () => {
    expect(placePieces(TWO_LARGE, { ...FACTS, git: false })).toMatchObject({
      placement: 'in_order',
      row: 1,
      reason: 'the project is not a git repository',
    });
  });

  it('row 1: small pieces run in order', () => {
    const small = TWO_LARGE.map((p) => ({ ...p, sizeEstimate: 20_000 }));
    expect(placePieces(small, FACTS)).toMatchObject({
      placement: 'in_order',
      reason: 'fewer than 2 independent large pieces',
    });
  });

  it('row 1: a chain saves too little', () => {
    const chain = [
      piece('P1'),
      piece('P2', { dependsOn: ['P1'], sizeEstimate: 200_000 }),
      piece('P3', { sizeEstimate: 40_000 }),
    ];
    expect(placePieces(chain, FACTS).reason).toMatch(/^critical-path saving \d+% is below 35%$/);
  });

  it('row 1: large pieces that share a file are not independent', () => {
    const overlapping = [
      piece('P1', { owned: { paths: ['src/a.ts'], globs: [] } }),
      piece('P2', { owned: { paths: ['src/a.ts'], globs: [] } }),
    ];
    expect(placePieces(overlapping, FACTS).placement).toBe('in_order');
  });

  it('row 1: Jev in the unsure band can keep it in order', () => {
    const unsure = [
      piece('P1'),
      piece('P2'),
      piece('P3', { dependsOn: ['P1'], sizeEstimate: 25_000 }),
    ];
    const saving = criticalPathSaving(unsure);
    expect(saving).toBeGreaterThanOrEqual(0.35);
    expect(saving).toBeLessThan(0.45);
    expect(placePieces(unsure, { ...FACTS, splitWorthIt: 0.1 })).toMatchObject({
      placement: 'in_order',
      splitUnsure: true,
    });
    expect(placePieces(unsure, FACTS).placement).toBe('shared');
  });

  it('row 3: independent large pieces with separate files share the tree', () => {
    expect(placePieces(TWO_LARGE, FACTS)).toMatchObject({
      placement: 'shared',
      row: 3,
      reason: 'independent pieces with separate files',
    });
  });

  it.each([
    [{ repoBusy: true }, 'another task is working in this repo'],
    [{ skipsGate: true }, "the agent's mode skips the approval gate"],
    [{ destructive: true }, 'the story deletes, migrates or rewrites data'],
  ])('row 2: %o sends pieces to worktrees', (overrides, reason) => {
    expect(placePieces(TWO_LARGE, { ...FACTS, ...overrides })).toMatchObject({
      placement: 'worktree',
      row: 2,
      reason,
    });
  });

  it('row 2: a long piece or a blocker file needs a worktree', () => {
    const long = [piece('P1', { sizeEstimate: 95_000 }), piece('P2', { sizeEstimate: 60_000 })];
    expect(placePieces(long, FACTS).reason).toBe('P1 is a long piece');
    const manifest = [piece('P1', { owned: { paths: ['package.json'], globs: [] } }), piece('P2')];
    expect(placePieces(manifest, FACTS).reason).toBe('P1 owns package.json, a manifest');
  });

  it('row 3: Jev can keep a blocker file in the shared tree, but not a destructive story', () => {
    const manifest = [piece('P1', { owned: { paths: ['package.json'], globs: [] } }), piece('P2')];
    expect(placePieces(manifest, { ...FACTS, sameFolder: 0.9 }).placement).toBe('shared');
    expect(placePieces(manifest, { ...FACTS, sameFolder: 0.9, destructive: true }).placement).toBe(
      'worktree',
    );
  });

  it('places research pieces read-only whatever the row', () => {
    const withResearch = [
      ...TWO_LARGE,
      piece('R1', { research: true, owned: { paths: [], globs: [] } }),
    ];
    const placed = placePieces(withResearch, FACTS);
    expect(placed.pieces.find((p) => p.key === 'R1')?.placement).toBe('read_only');
    expect(placed.pieces.find((p) => p.key === 'P1')?.placement).toBe('shared');
  });
});

describe('sharedTreeBlocker', () => {
  it('names manifests, lockfiles, generated files and migrations', () => {
    expect(sharedTreeBlocker('apps/web/package.json')).toBe('a manifest');
    expect(sharedTreeBlocker('pnpm-lock.yaml')).toBe('a lockfile');
    expect(sharedTreeBlocker('dist/index.js')).toBe('a generated file');
    expect(sharedTreeBlocker('apps/server/migrations/0059_x.sql')).toBe('a migration');
    expect(sharedTreeBlocker('apps/server/src/a.ts')).toBeNull();
  });
});
