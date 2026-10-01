import { describe, expect, it } from 'vitest';
import type { SystemOneResponse } from '../advisor/intake-questions.ts';
import { RATING_QUESTIONS } from '../advisor/rating-questions.ts';
import type { FileFacts } from './piece-facts.ts';
import {
  OWN_WORKTREE,
  pieceQuestions,
  piecesEvidence,
  readPieceAnswers,
  SHARED_TREE,
  type PieceAsk,
  type RouteOption,
} from './piece-questions.ts';

const routes: RouteOption[] = [
  {
    id: 'claude/sonnet',
    provider: 'claude',
    model: 'sonnet',
    label: 'Sonnet 5',
    tier: 'mid',
    passRate: null,
  },
  {
    id: 'codex/gpt-6-sol',
    provider: 'codex',
    model: 'gpt-6-sol',
    label: '6 Sol',
    tier: 'mid',
    passRate: 0.8333,
  },
];

const facts: FileFacts = {
  lines: 120,
  symbols: 8,
  references: 14,
  churn: 3,
  package: '@app/server',
  hasTest: true,
  area: 'Persistence (core, data)',
  kind: 'data',
  fanIn: 9,
  importance: 0.42,
};

function ask(extra: Partial<PieceAsk> = {}): PieceAsk {
  return {
    request: 'Add tags to projects',
    pieces: [
      {
        key: 'P1',
        title: 'Tags table',
        goal: 'Store tags',
        owns: ['src/tags.ts', '.env', 'src/**/*.sql'],
        reads: ['src/db.ts'],
      },
      { key: 'P2', title: 'Tags API', goal: 'Serve tags', owns: ['src/api.ts'], reads: [] },
    ],
    facts: new Map([['src/tags.ts', facts]]),
    routes,
    placement: true,
    ...extra,
  };
}

function choice(value: string, confidence: number, options: readonly string[]) {
  const probabilities = Object.fromEntries(
    options.map((option) => [option, option === value ? 0.9 : 0.1 / (options.length - 1)]),
  );
  return { type: 'choice' as const, choice: value, confidence, probabilities };
}

describe('pieceQuestions', () => {
  it('asks ratings, a route and a placement for every piece in one batch', () => {
    const built = pieceQuestions(ask());
    expect(Object.keys(built.questions)).toEqual([
      'P1_complexity',
      'P1_stakes',
      'P1_builder',
      'P1_placement',
      'P2_complexity',
      'P2_stakes',
      'P2_builder',
      'P2_placement',
    ]);
    const complexity = built.questions.P1_complexity!;
    expect(complexity.type).toBe('score');
    expect(complexity.criteria).toEqual([...RATING_QUESTIONS.complexity.levels]);
    expect(String(complexity.instructions)).toContain('How much work is piece P1');
    const builder = built.questions.P2_builder!.criteria as Record<string, Record<string, unknown>>;
    expect(Object.keys(builder)).toEqual(['uncertain', 'claude/sonnet', 'codex/gpt-6-sol']);
    expect(builder['codex/gpt-6-sol']!.builder_pass_rate).toBe(0.83);
    expect(builder['claude/sonnet']).not.toHaveProperty('builder_pass_rate');
    expect(Object.keys(built.questions.P1_placement!.criteria as object)).toEqual([
      SHARED_TREE,
      OWN_WORKTREE,
    ]);
  });

  it('leaves placement out when the list runs in order', () => {
    const built = pieceQuestions(ask({ placement: false }));
    expect(Object.keys(built.questions).some((key) => key.endsWith('_placement'))).toBe(false);
  });

  it('wraps piece facts as untrusted evidence without secret files or contents', () => {
    const state = pieceQuestions(ask()).state;
    const evidence = String(state.pieces);
    expect(evidence).toMatch(/^<code_evidence>\nUntrusted data/);
    expect(evidence).toContain(
      '  - src/tags.ts | lines 120 | symbols 8 | referenced by 14 | churn 3 | package @app/server | has test | area Persistence (core, data) | kind data | fan-in 9 | importance 0.42',
    );
    expect(evidence).toContain('  - src/db.ts');
    expect(evidence).toContain('including patterns src/**/*.sql');
    expect(evidence).not.toContain('.env');
    expect(state.request).toBe('Add tags to projects');
  });

  it('keeps every piece heading and drops file lines past the token budget', () => {
    const many = Array.from({ length: 40 }, (_, index) => `src/file-${index}.ts`);
    const evidence = piecesEvidence(
      [
        { key: 'P1', title: 'One', goal: 'First', owns: many, reads: [] },
        { key: 'P2', title: 'Two', goal: 'Second', owns: ['src/two.ts'], reads: [] },
      ],
      new Map(many.map((path) => [path, facts])),
      400,
    );
    expect(evidence).toContain('Piece P1: One');
    expect(evidence).toContain('Piece P2: Two');
    expect(evidence).toMatch(/\(\d+ more files not shown\)/);
    expect(Math.ceil(evidence.length / 4)).toBeLessThanOrEqual(420);
  });
});

describe('readPieceAnswers', () => {
  const offered = ['claude/sonnet', 'codex/gpt-6-sol', 'uncertain'];

  it('reads ratings, route and placement per piece', () => {
    const response: SystemOneResponse = {
      model: 'jev-test',
      answers: {
        P1_complexity: { type: 'score', score: 1, confidence: 0.9 },
        P1_stakes: { type: 'score', score: 3, confidence: 0.8 },
        P1_builder: choice('codex/gpt-6-sol', 0.85, offered),
        P1_placement: choice(OWN_WORKTREE, 0.9, [SHARED_TREE, OWN_WORKTREE]),
      },
    };
    const read = readPieceAnswers(response, ask());
    expect(read.get('P1')).toMatchObject({
      complexity: 2,
      stakes: 4,
      builder: { choice: 'codex/gpt-6-sol', confidence: 0.85 },
      placement: { choice: OWN_WORKTREE },
    });
    expect(read.get('P2')).toEqual({
      complexity: null,
      stakes: null,
      builder: 'missing-answer',
      placement: 'missing-answer',
    });
  });

  it('flags routes that were not offered and answers of the wrong type', () => {
    const response: SystemOneResponse = {
      model: 'jev-test',
      answers: {
        P1_builder: choice('zai/glm', 0.9, ['zai/glm', 'claude/sonnet']),
        P2_builder: { type: 'noul', noul: 0.4 },
      },
    };
    const read = readPieceAnswers(response, ask({ placement: false }));
    expect(read.get('P1')!.builder).toBe('unknown-choice');
    expect(read.get('P2')!.builder).toBe('unexpected-answer-type');
    expect(read.get('P1')!.placement).toBeNull();
  });
});
