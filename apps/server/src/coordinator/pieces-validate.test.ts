import { describe, expect, it } from 'vitest';
import { piecesHash, validatePieces, type ValidationFacts } from './pieces-validate.ts';

const FILES = [
  'apps/server/src/persistence/projects.ts',
  'apps/server/src/api/app.ts',
  'apps/web/src/tags/TagList.tsx',
  'apps/web/src/tags/TagChips.tsx',
  'package.json',
  '.env',
];

const facts = (overrides: Partial<ValidationFacts> = {}): ValidationFacts => ({
  files: FILES,
  isSecret: (path) => path === '.env',
  lines: () => 100,
  budgetTokens: 100_000,
  projectChecks: ['pnpm test'],
  planSteps: [],
  ...overrides,
});

const piece = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  title: `Piece ${key}`,
  goal: `Do ${key}`,
  owns: [`apps/server/src/${key.toLowerCase()}.ts`],
  size: 'M',
  ...extra,
});

function errorsOf(block: unknown, overrides: Partial<ValidationFacts> = {}): string[] {
  const result = validatePieces(block, facts(overrides));
  return result.ok ? [] : result.errors;
}

describe('validatePieces', () => {
  it('accepts a valid list and expands owned globs against the project files', () => {
    const result = validatePieces(
      {
        pieces: [
          piece('P1'),
          piece('P2', { owns: ['apps/web/src/tags/*.tsx'], dependsOn: ['P1'] }),
        ],
        integration: 'Wire the route',
      },
      facts(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pieces[1]!.owned).toEqual({
      paths: ['apps/web/src/tags/TagList.tsx', 'apps/web/src/tags/TagChips.tsx'],
      globs: ['apps/web/src/tags/*.tsx'],
    });
    expect(result.value.integration).toBe('Wire the route');
  });

  it('names a dependency cycle', () => {
    const errors = errorsOf({
      pieces: [
        piece('P1', { dependsOn: ['P3'] }),
        piece('P2', { dependsOn: ['P1'] }),
        piece('P3', { dependsOn: ['P2'] }),
      ],
    });
    expect(errors).toContain('dependsOn has a cycle: P1 → P3 → P2 → P1');
  });

  it('refuses unknown dependencies and duplicate keys', () => {
    const errors = errorsOf({ pieces: [piece('P1', { dependsOn: ['P9'] }), piece('P1')] });
    expect(errors).toEqual(
      expect.arrayContaining([
        'piece key P1 is used twice',
        'P1 depends on P9, which is not a piece',
      ]),
    );
  });

  it('requires two pieces that own the same file to be ordered', () => {
    const shared = { owns: ['apps/server/src/api/app.ts'] };
    expect(errorsOf({ pieces: [piece('P1', shared), piece('P2', shared)] })).toEqual([
      'P1 and P2 both own apps/server/src/api/app.ts; make one depend on the other',
    ]);
    expect(
      errorsOf({ pieces: [piece('P1', shared), piece('P2', { ...shared, dependsOn: ['P1'] })] }),
    ).toEqual([]);
  });

  it('makes a piece that reads another piece’s file depend on it', () => {
    const result = validatePieces(
      { pieces: [piece('P1'), piece('P2', { reads: ['apps/server/src/p1.ts'] })] },
      facts(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pieces.map((entry) => entry.dependsOn)).toEqual([[], ['P1']]);
  });

  it('refuses a read that would close a dependency cycle', () => {
    const errors = errorsOf({
      pieces: [
        piece('P1', { dependsOn: ['P2'] }),
        piece('P2', { reads: ['apps/server/src/p1.ts'] }),
      ],
    });
    expect(errors).toEqual([
      'P2 reads apps/server/src/p1.ts, which P1 owns, but P1 already depends on P2; move the shared part into one piece',
    ]);
  });

  it('refuses secret files, .git and paths outside the project', () => {
    const errors = errorsOf({
      pieces: [piece('P1', { owns: ['.env', '.git/config', '../outside.ts', 'nowhere/x/y.ts'] })],
    });
    expect(errors).toEqual([
      'P1 owns `.env`, a secret file',
      'P1 owns `.git/config` inside .git',
      'P1 owns `../outside.ts`, which is not a path inside the project',
      'P1 owns `nowhere/x/y.ts`, which is not under any folder in the project',
    ]);
  });

  it('asks to split a piece bigger than the Builder budget', () => {
    const errors = errorsOf({ pieces: [piece('P1')] }, { budgetTokens: 10_000 });
    expect(errors[0]).toMatch(/^P1 is too big for one Builder .* split it$/);
  });

  it('refuses whole-project checks inside a piece', () => {
    const errors = errorsOf({
      pieces: [
        piece('P1', { checks: ['pnpm test', 'pnpm vitest run apps/server/src/p1.test.ts'] }),
      ],
    });
    expect(errors).toEqual([
      "P1's check `pnpm test` is a whole-project check; narrow it to the piece's files (the coordinator runs the full checks after integration)",
    ]);
  });

  it('checks that every plan step has a piece', () => {
    const errors = errorsOf(
      { pieces: [piece('P1', { title: 'Tags table and repository' })] },
      {
        planSteps: [
          { text: 'Tags table and repository', files: [] },
          { text: 'Budget bar in the project page', files: [] },
        ],
      },
    );
    expect(errors).toEqual(['no piece covers the plan item "Budget bar in the project page"']);
  });

  it('counts a step covered when a piece owns a file the step or its section names', () => {
    const step = {
      text: 'Read the `amount` field before saving',
      files: ['apps/server/src/p1.ts'],
    };
    expect(errorsOf({ pieces: [piece('P1')] }, { planSteps: [step] })).toEqual([]);
  });

  it('only lets research pieces own nothing', () => {
    expect(errorsOf({ pieces: [piece('P1', { owns: [] })] })).toEqual([
      'P1 owns no files; only research pieces may own none',
    ]);
    expect(errorsOf({ pieces: [piece('R1', { owns: [], research: true })] })).toEqual([]);
  });

  it('reports schema problems with their path', () => {
    const errors = errorsOf({ pieces: [{ key: 'P1' }] });
    expect(errors.some((error) => error.startsWith('pieces.0.title'))).toBe(true);
  });

  it('caps the list at 8 pieces', () => {
    const pieces = Array.from({ length: 9 }, (_, index) => piece(`P${index + 1}`));
    expect(errorsOf({ pieces })).toContain('9 pieces; use at most 8');
  });
});

describe('piecesHash', () => {
  it('ignores order and wording but changes with ownership', () => {
    const a = [
      { ...piece('P1'), reads: [], dependsOn: [], contract: null, acceptance: [], checks: [] },
    ];
    const renamed = [{ ...a[0]!, title: 'Other title' }];
    const moved = [{ ...a[0]!, owns: ['apps/server/src/other.ts'] }];
    type Drafts = Parameters<typeof piecesHash>[0];
    expect(piecesHash(renamed as unknown as Drafts)).toBe(piecesHash(a as unknown as Drafts));
    expect(piecesHash(moved as unknown as Drafts)).not.toBe(piecesHash(a as unknown as Drafts));
  });
});
