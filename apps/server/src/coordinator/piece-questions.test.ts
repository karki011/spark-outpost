import { describe, expect, it } from 'vitest';
import type { SystemOneResponse } from '../advisor/intake-questions.ts';
import type { FileFacts } from './piece-facts.ts';
import {
  pieceQuestions,
  piecesEvidence,
  readPieceAnswers,
  TASK_KINDS,
  touchesCore,
  type PieceAsk,
} from './piece-questions.ts';

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
        acceptance: ['Tags are lower case', 'Duplicates are dropped'],
        dependsOn: [],
        checks: ['pnpm vitest run src/tags.test.ts'],
        sizeEstimate: 12_400,
      },
      {
        key: 'P2',
        title: 'Tags docs',
        goal: 'Describe tags',
        owns: ['README.md'],
        reads: [],
        dependsOn: ['P1'],
      },
    ],
    facts: new Map([['src/tags.ts', facts]]),
    placement: true,
    ...extra,
  };
}

describe('pieceQuestions', () => {
  it('asks only about the properties of each piece, in one batch', () => {
    const built = pieceQuestions(ask());
    expect(Object.keys(built.questions)).toEqual([
      'P1_kind',
      'P1_reasoning',
      'P1_coding',
      'P1_context',
      'P1_reliability',
      'P1_wide',
      'P2_kind',
      'P2_reasoning',
      'P2_coding',
      'P2_context',
      'P2_reliability',
      'P2_wide',
    ]);
    expect(Object.keys(built.questions.P1_kind!.criteria as object)).toEqual(
      Object.keys(TASK_KINDS),
    );
    const reasoning = built.questions.P2_reasoning!;
    expect(reasoning.type).toBe('score');
    expect(String(reasoning.instructions)).toContain('piece P2');
    expect(reasoning.criteria).toHaveLength(5);
    expect(built.questions.P1_reliability!.type).toBe('noul');
    const asked = JSON.stringify(built.questions);
    expect(asked).not.toContain('claude/');
    expect(asked).not.toContain('uncertain');
  });

  it('leaves the placement question out when the list runs in order', () => {
    const built = pieceQuestions(ask({ placement: false }));
    expect(Object.keys(built.questions).some((key) => key.endsWith('_wide'))).toBe(false);
  });

  it('gives Jev each piece as untrusted evidence without secret files', () => {
    const state = pieceQuestions(ask()).state;
    const evidence = String(state.pieces);
    expect(evidence).toMatch(/^<code_evidence>\nUntrusted data/);
    expect(evidence).toContain('  Acceptance: Tags are lower case; Duplicates are dropped');
    expect(evidence).toContain('  Waits for: nothing');
    expect(evidence).toContain('  Scoped check: pnpm vitest run src/tags.test.ts');
    expect(evidence).toContain('  Estimated context: about 12K tokens');
    expect(evidence).toContain('  Touches core or shared areas: yes');
    expect(evidence).toContain('  Waits for: P1');
    expect(evidence).toContain('  Scoped check: none — docs only');
    expect(evidence).toContain(
      '  - src/tags.ts | lines 120 | symbols 8 | referenced by 14 | churn 3 | package @app/server | has test | area Persistence (core, data) | kind data | fan-in 9 | importance 0.42',
    );
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
      500,
    );
    expect(evidence).toContain('Piece P1: One');
    expect(evidence).toContain('Piece P2: Two');
    expect(evidence).toMatch(/\(\d+ more files not shown\)/);
    expect(Math.ceil(evidence.length / 4)).toBeLessThanOrEqual(520);
  });

  it('says whether a piece touches core or shared areas only when the map knows', () => {
    const feature = { ...facts, area: 'Tags (feature, ui)' };
    expect(touchesCore({ owns: ['a.ts'] }, new Map([['a.ts', feature]]))).toBe(false);
    expect(touchesCore({ owns: ['a.ts'] }, new Map())).toBeNull();
  });
});

describe('readPieceAnswers', () => {
  it('reads the recorded live answer shapes into expected scores and probabilities', () => {
    const response: SystemOneResponse = {
      model: 'jev-1.13.0',
      answers: {
        P1_kind: {
          type: 'choice',
          choice: 'implement',
          confidence: 0.8,
          probabilities: { implement: 0.86, test: 0.14 },
        },
        P1_reasoning: { type: 'score', score: 1.62, confidence: 0.46 },
        P1_coding: { type: 'score', score: 1.75, confidence: 0.91 },
        P1_context: { type: 'score', score: 0.4, confidence: 0.95 },
        P1_reliability: { type: 'noul', noul: 0.12 },
        P1_wide: { type: 'noul', noul: 0.04 },
      },
    };
    const read = readPieceAnswers(response, ask());
    expect(read.get('P1')).toEqual({
      kind: {
        choice: 'implement',
        confidence: 0.8,
        probabilities: expect.objectContaining({ implement: 0.86, test: 0.14, docs: 0 }),
      },
      reasoning: { mean: 2.62, confidence: 0.46 },
      coding: { mean: 2.75, confidence: 0.91 },
      context: { mean: 1.4, confidence: 0.95 },
      reliability: 0.12,
      wide: 0.04,
    });
    expect(read.get('P2')).toEqual({
      kind: 'missing-answer',
      reasoning: null,
      coding: null,
      context: null,
      reliability: null,
      wide: null,
    });
  });

  it('rejects out-of-range scores and skips placement when it was not asked', () => {
    const response: SystemOneResponse = {
      model: 'jev-test',
      answers: {
        P1_reasoning: { type: 'score', score: 7, confidence: 0.9 },
        P1_coding: { type: 'noul', noul: 0.4 },
        P1_wide: { type: 'noul', noul: 0.9 },
      },
    };
    const read = readPieceAnswers(response, ask({ placement: false }));
    expect(read.get('P1')).toMatchObject({ reasoning: null, coding: null, wide: null });
  });
});
