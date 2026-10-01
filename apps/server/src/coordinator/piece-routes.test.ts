import { describe, expect, it } from 'vitest';
import type { AgentPick } from '@spark-outpost/contracts';
import { context } from '../orchestration/route-fixtures.ts';
import {
  OWN_WORKTREE,
  SHARED_TREE,
  type PieceAnswer,
  type RouteOption,
} from './piece-questions.ts';
import { routePieceList, type RoutablePiece, type RouteRules } from './piece-routes.ts';

const SONNET: AgentPick = {
  provider: 'claude',
  model: 'sonnet',
  modelLabel: 'Sonnet 5',
  effort: 'medium',
};

const routes: RouteOption[] = [
  { id: 'claude/sonnet', provider: 'claude', model: 'sonnet', label: 'Sonnet 5', tier: 'mid' },
  { id: 'claude/opus[1m]', provider: 'claude', model: 'opus[1m]', label: 'Opus 5.5', tier: 'top' },
  { id: 'codex/gpt-6-sol', provider: 'codex', model: 'gpt-6-sol', label: '6 Sol', tier: 'mid' },
].map((route) => ({ ...route, tier: route.tier as RouteOption['tier'], passRate: null }));

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
    destructive: () => false,
    listIsolation: null,
    pieceIsolation: () => null,
    ...extra,
  };
}

function distribution(choice: string, confidence: number) {
  return { choice, confidence, probabilities: { [choice]: confidence } };
}

function answer(builder: string, confidence = 0.9, placement?: string): PieceAnswer {
  return {
    complexity: 2,
    stakes: 3,
    builder: distribution(builder, confidence),
    placement: placement ? distribution(placement, 0.9) : null,
  };
}

const fileCount = (entry: RoutablePiece) => entry.owned.paths.length;

describe('routePieceList', () => {
  it('applies a different Jev route to each piece, with the ratings as the reason', () => {
    const routed = routePieceList(
      pieces,
      rules(),
      {
        answers: new Map([
          ['P1', answer('codex/gpt-6-sol')],
          ['P2', answer('claude/opus[1m]')],
        ]),
        failure: null,
      },
      fileCount,
    );
    expect(routed.pieces.map((entry) => [entry.key, entry.model.pick.model])).toEqual([
      ['P1', 'gpt-6-sol'],
      ['P2', 'opus[1m]'],
    ]);
    expect(routed.pieces[0]!.model).toMatchObject({
      decidedBy: 'jev',
      reason: 'complexity 2/5, stakes 3/5, 1 file',
      jevPick: { provider: 'codex', model: 'gpt-6-sol' },
    });
  });

  it('keeps the rules picks and records why when Jev did not answer', () => {
    const routed = routePieceList(
      pieces,
      rules(),
      { answers: null, failure: 'Jev timed out' },
      fileCount,
    );
    expect(routed.pieces.map((entry) => entry.model)).toEqual([
      { pick: SONNET, jevPick: null, decidedBy: 'rules', reason: 'Jev timed out' },
      { pick: SONNET, jevPick: null, decidedBy: 'rules', reason: 'Jev timed out' },
    ]);
    expect(routed.placement).toBe('shared');
    expect(routed.pieces.map((entry) => entry.place.placement)).toEqual(['shared', 'shared']);
  });

  it.each([
    ['uncertain', 0.9, 'Jev was unsure'],
    ['codex/gpt-6-sol', 0.5, 'Jev was unsure (0.50)'],
  ])('falls back to rules when Jev answers %s at %s', (choice, confidence, reason) => {
    const routed = routePieceList(
      [pieces[0]!],
      rules(),
      { answers: new Map([['P1', answer(choice, confidence)]]), failure: null },
      fileCount,
    );
    expect(routed.pieces[0]!.model).toMatchObject({ pick: SONNET, decidedBy: 'rules', reason });
  });

  it('floors a destructive piece to the top tier of the provider Jev chose', () => {
    const routed = routePieceList(
      pieces,
      rules({ destructive: (entry) => entry.key === 'P2' }),
      {
        answers: new Map([
          ['P1', answer('claude/sonnet')],
          ['P2', answer('claude/sonnet')],
        ]),
        failure: null,
      },
      fileCount,
    );
    expect(routed.pieces[0]!.model).toMatchObject({ decidedBy: 'jev' });
    expect(routed.pieces[1]!.model).toMatchObject({
      pick: { provider: 'claude', model: 'opus[1m]' },
      jevPick: { model: 'sonnet' },
      decidedBy: 'floor',
      reason: 'destructive → top tier',
    });
  });

  it('moves a piece to its own worktree when Jev is confident, leaving the list mixed', () => {
    const routed = routePieceList(
      pieces,
      rules(),
      {
        answers: new Map([
          ['P1', answer('uncertain', 0.9, SHARED_TREE)],
          ['P2', answer('uncertain', 0.9, OWN_WORKTREE)],
        ]),
        failure: null,
      },
      fileCount,
    );
    expect(routed.pieces.map((entry) => [entry.place.placement, entry.place.decidedBy])).toEqual([
      ['shared', 'jev'],
      ['worktree', 'jev'],
    ]);
    expect(routed.placement).toBe('shared');
  });

  it('keeps hard isolation rules over Jev placement', () => {
    const routed = routePieceList(
      pieces,
      rules({
        placement: 'worktree',
        pieceIsolation: (entry) => (entry.key === 'P1' ? 'owns a lockfile' : null),
      }),
      {
        answers: new Map([
          ['P1', answer('uncertain', 0.9, SHARED_TREE)],
          ['P2', answer('uncertain', 0.9, SHARED_TREE)],
        ]),
        failure: null,
      },
      fileCount,
    );
    expect(routed.pieces.map((entry) => [entry.place.placement, entry.place.reason])).toEqual([
      ['worktree', 'owns a lockfile'],
      ['shared', 'shared tree'],
    ]);
  });

  it('never leaves two unordered pieces with the same files in the shared tree', () => {
    const overlapping = [
      piece('P1', ['a.ts']),
      piece('P2', ['a.ts', 'b.ts']),
      piece('P3', ['a.ts'], { dependsOn: ['P1'] }),
    ];
    const routed = routePieceList(
      overlapping,
      rules(),
      { answers: null, failure: null },
      fileCount,
    );
    expect(routed.pieces.map((entry) => [entry.key, entry.place.placement])).toEqual([
      ['P1', 'shared'],
      ['P2', 'worktree'],
      ['P3', 'shared'],
    ]);
    expect(routed.pieces[1]!.place.reason).toBe('shares files with P1');
  });

  it('leaves in-order lists and read-only pieces alone', () => {
    const routed = routePieceList(
      [...pieces, piece('R1', [], { research: true })],
      rules({ placement: 'in_order', askPlacement: false }),
      { answers: null, failure: null },
      fileCount,
    );
    expect(routed.placement).toBe('in_order');
    expect(routed.pieces.map((entry) => entry.place.placement)).toEqual([
      'in_order',
      'in_order',
      'read_only',
    ]);
  });
});
