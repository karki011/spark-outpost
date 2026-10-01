import { describe, expect, it } from 'vitest';
import type { AgentPick } from '@spark-outpost/contracts';
import { context } from '../orchestration/route-fixtures.ts';
import { OWN_WORKTREE, type PieceAnswer, type RouteOption } from './piece-questions.ts';
import { routePieceList, type RoutablePiece, type RouteRules } from './piece-routes.ts';

const SONNET: AgentPick = {
  provider: 'claude',
  model: 'sonnet',
  modelLabel: 'Sonnet 5',
  effort: 'medium',
};

const routes: RouteOption[] = [
  {
    id: 'claude/sonnet',
    provider: 'claude',
    model: 'sonnet',
    label: 'Sonnet 5',
    tier: 'mid',
    passRate: 0.6,
  },
  {
    id: 'claude/opus[1m]',
    provider: 'claude',
    model: 'opus[1m]',
    label: 'Opus 5.5',
    tier: 'top',
    passRate: null,
  },
  {
    id: 'codex/gpt-6-sol',
    provider: 'codex',
    model: 'gpt-6-sol',
    label: '6 Sol',
    tier: 'mid',
    passRate: 0.85,
  },
].map((route) => ({
  ...route,
  tier: route.tier as RouteOption['tier'],
  strengths: [],
  contextTokens: null,
  priceUsd: null,
}));

function piece(key: string, owns: string[], extra: Partial<RoutablePiece> = {}): RoutablePiece {
  return { key, owned: { paths: owns, globs: [] }, dependsOn: [], research: false, ...extra };
}

const pieces = [piece('P1', ['a.ts']), piece('P2', ['b.ts', 'c.ts'])];

function rules(extra: Partial<RouteRules> = {}): RouteRules {
  return {
    route: context('pinned'),
    picks: new Map([
      ['P1', SONNET],
      ['P2', SONNET],
      ['P3', SONNET],
      ['R1', SONNET],
    ]),
    routes,
    placement: 'shared',
    askPlacement: true,
    requestDestructive: false,
    destructive: () => false,
    core: () => false,
    listIsolation: null,
    pieceIsolation: () => null,
    ...extra,
  };
}

const score = (mean: number, confidence = 0.9) => ({ mean, confidence });

function answer(extra: Partial<PieceAnswer> = {}): PieceAnswer {
  return {
    kind: { choice: 'implement', confidence: 0.9, probabilities: { implement: 0.9 } },
    reasoning: score(2.6),
    coding: score(3),
    context: score(2),
    reliability: 0.1,
    wide: null,
    ...extra,
  };
}

const HARD = answer({ reasoning: score(4.3), coding: score(4), context: score(3) });

const fileCount = (entry: RoutablePiece) => entry.owned.paths.length;

function routed(answers: [string, PieceAnswer][], extra: Partial<RouteRules> = {}) {
  return routePieceList(
    pieces,
    rules(extra),
    { answers: new Map(answers), failure: null },
    fileCount,
  );
}

describe('routePieceList', () => {
  it('composes a tier from Jev’s ratings and picks the model in code', () => {
    const result = routed([
      ['P1', answer()],
      ['P2', HARD],
    ]);
    expect(result.pieces.map((entry) => [entry.key, entry.model.pick.model])).toEqual([
      ['P1', 'gpt-6-sol'],
      ['P2', 'opus[1m]'],
    ]);
    expect(result.pieces[0]!.model).toMatchObject({
      decidedBy: 'jev',
      reason: 'reasoning 2.6, coding 3, context 2 → mid tier → Codex 6 Sol (best pass rate)',
      jevPick: { provider: 'codex', model: 'gpt-6-sol' },
      demand: { tier: 'mid' },
    });
    expect(result.pieces[1]!.model.reason).toBe(
      'reasoning 4.3, coding 4, context 3 → top tier → Claude Opus 5.5 (only top-tier route)',
    );
    expect(result.pieces[0]!.answer).toEqual(answer());
  });

  it('keeps the rules picks and records why when Jev did not answer', () => {
    const result = routePieceList(
      pieces,
      rules(),
      { answers: null, failure: 'Jev timed out' },
      fileCount,
    );
    expect(result.pieces.map((entry) => entry.model)).toEqual([
      { pick: SONNET, jevPick: null, decidedBy: 'rules', reason: 'Jev timed out' },
      { pick: SONNET, jevPick: null, decidedBy: 'rules', reason: 'Jev timed out' },
    ]);
    expect(result.placement).toBe('shared');
    expect(result.pieces.map((entry) => entry.place.placement)).toEqual(['shared', 'shared']);
  });

  it('never downgrades on an unsure rating: the rules pick stands', () => {
    const result = routed([['P1', answer({ reasoning: score(1, 0.3) })]]);
    expect(result.pieces[0]!.model).toMatchObject({
      pick: SONNET,
      decidedBy: 'rules',
      reason: 'Jev was unsure (reasoning 0.30)',
    });
  });

  it('steps up when no route is healthy at the demanded tier', () => {
    const midOnly = routes.filter((route) => route.tier === 'mid');
    const result = routed([['P1', HARD]], { routes: midOnly });
    expect(result.pieces[0]!.model).toMatchObject({
      pick: SONNET,
      decidedBy: 'rules',
      reason: 'no healthy top-tier route or higher',
      demand: { tier: 'top' },
    });
  });

  it('sends a destructive piece to the top tier and says why', () => {
    const result = routed(
      [
        ['P1', answer()],
        ['P2', answer()],
      ],
      { destructive: (entry) => entry.key === 'P2' },
    );
    expect(result.pieces[0]!.model).toMatchObject({
      decidedBy: 'jev',
      pick: { model: 'gpt-6-sol' },
    });
    expect(result.pieces[1]!.model).toMatchObject({
      pick: { provider: 'claude', model: 'opus[1m]' },
      decidedBy: 'jev',
      reason:
        'reasoning 2.6, coding 3, context 2 → top tier (destructive) → Claude Opus 5.5 (only top-tier route)',
    });
  });

  it('keeps a request-wide destructive floor off the pieces it can be pinned to', () => {
    const owned = routed(
      [
        ['P1', answer()],
        ['P2', answer()],
      ],
      { requestDestructive: true, destructive: (entry) => entry.key === 'P1' },
    );
    expect(owned.pieces.map((entry) => [entry.key, entry.model.pick.model])).toEqual([
      ['P1', 'opus[1m]'],
      ['P2', 'gpt-6-sol'],
    ]);
    const migrate = answer({
      kind: { choice: 'migrate', confidence: 1, probabilities: { migrate: 1 } },
    });
    const byJev = routed(
      [
        ['P1', migrate],
        ['P2', answer()],
      ],
      { requestDestructive: true },
    );
    expect(byJev.pieces.map((entry) => entry.model.pick.model)).toEqual(['opus[1m]', 'gpt-6-sol']);
    expect(byJev.pieces[0]!.model.reason).toContain('top tier (destructive)');
    const stakes = routed(
      [
        ['P1', answer()],
        ['P2', answer({ reliability: 0.7 })],
      ],
      { requestDestructive: true },
    );
    expect(stakes.pieces.map((entry) => entry.model.pick.model)).toEqual(['gpt-6-sol', 'opus[1m]']);
  });

  it('floors every building piece when the destructive request names none of them', () => {
    const result = routed(
      [
        ['P1', answer()],
        ['P2', answer()],
      ],
      { requestDestructive: true },
    );
    expect(result.pieces.map((entry) => entry.model.pick.model)).toEqual(['opus[1m]', 'opus[1m]']);
    expect(result.pieces[1]!.model.demand).toMatchObject({ tier: 'top', raisedBy: 'destructive' });
  });

  it('places a wide or risky piece in its own worktree, leaving the list mixed', () => {
    const result = routed([
      ['P1', answer({ wide: 0.1 })],
      ['P2', answer({ wide: 0.7 })],
    ]);
    expect(
      result.pieces.map((entry) => [entry.place.placement, entry.place.decidedBy, entry.place.jev]),
    ).toEqual([
      ['shared', 'jev', 'shared_tree'],
      ['worktree', 'jev', OWN_WORKTREE],
    ]);
    expect(result.pieces[1]!.place.reason).toBe('own worktree (wide or risky 0.70)');
    expect(result.placement).toBe('shared');
  });

  it('keeps the rules placement when Jev is in between', () => {
    const result = routed([['P1', answer({ wide: 0.35 })]], { placement: 'worktree' });
    expect(result.pieces[0]!.place).toEqual({
      placement: 'worktree',
      jev: null,
      decidedBy: 'rules',
      reason: 'Jev was unsure (wide or risky 0.35)',
    });
  });

  it('keeps hard isolation rules over Jev placement', () => {
    const result = routed(
      [
        ['P1', answer({ wide: 0.1 })],
        ['P2', answer({ wide: 0.1 })],
      ],
      {
        placement: 'worktree',
        pieceIsolation: (entry) => (entry.key === 'P1' ? 'owns a lockfile' : null),
      },
    );
    expect(result.pieces.map((entry) => [entry.place.placement, entry.place.reason])).toEqual([
      ['worktree', 'owns a lockfile'],
      ['shared', 'shared tree (wide or risky 0.10)'],
    ]);
  });

  it('never leaves two unordered pieces with the same files in the shared tree', () => {
    const overlapping = [
      piece('P1', ['a.ts']),
      piece('P2', ['a.ts', 'b.ts']),
      piece('P3', ['a.ts'], { dependsOn: ['P1'] }),
    ];
    const result = routePieceList(
      overlapping,
      rules(),
      { answers: null, failure: null },
      fileCount,
    );
    expect(result.pieces.map((entry) => [entry.key, entry.place.placement])).toEqual([
      ['P1', 'shared'],
      ['P2', 'worktree'],
      ['P3', 'shared'],
    ]);
    expect(result.pieces[1]!.place.reason).toBe('shares files with P1');
  });

  it('leaves in-order lists and read-only pieces alone', () => {
    const result = routePieceList(
      [...pieces, piece('R1', [], { research: true })],
      rules({ placement: 'in_order', askPlacement: false }),
      { answers: null, failure: null },
      fileCount,
    );
    expect(result.placement).toBe('in_order');
    expect(result.pieces.map((entry) => entry.place.placement)).toEqual([
      'in_order',
      'in_order',
      'read_only',
    ]);
  });
});
