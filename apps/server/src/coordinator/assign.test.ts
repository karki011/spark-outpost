import { describe, expect, it } from 'vitest';
import type { AgentPick, ModelStat } from '@spark-outpost/contracts';
import { candidates, context } from '../orchestration/route-fixtures.ts';
import type { AdvisorCandidate } from '../advisor/advice.ts';
import { assignPieces, fallbackPick, providerOption, type AssignFacts } from './assign.ts';

const SONNET: AgentPick = {
  provider: 'claude',
  model: 'sonnet',
  modelLabel: 'Sonnet 5',
  effort: 'medium',
};

function facts(extra: Partial<AssignFacts> = {}): AssignFacts {
  return {
    route: context('auto'),
    builder: SONNET,
    complex: false,
    unhealthy: new Map(),
    load: new Map(),
    parallel: false,
    ...extra,
  };
}

const pieces = [
  { key: 'P1', sizeEstimate: 30_000, research: false },
  { key: 'P2', sizeEstimate: 60_000, research: false },
  { key: 'P3', sizeEstimate: 20_000, research: false },
  { key: 'R1', sizeEstimate: 10_000, research: true },
];

function providers(assigned: ReturnType<typeof assignPieces>): [string, string][] {
  return assigned.map((entry) => [entry.key, entry.pick.provider]);
}

function stat(provider: 'claude' | 'codex', passed: number, n: number): ModelStat {
  return {
    source: 'benchmark',
    round: 'r1',
    measuredOn: '2026-09-01',
    file: 'x.md',
    provider,
    model: 'm',
    agentModel: 'm',
    effort: null,
    role: 'builder',
    category: 'fix',
    n,
    passed,
    meanCostUsd: 1,
    costSource: 'reported',
    meanWallMs: 1,
    sharedCredit: 0,
  };
}

describe('assignPieces', () => {
  it('keeps pieces in order on the chat provider and its routed Builder pick', () => {
    const assigned = assignPieces(pieces, facts());
    expect(assigned.every((entry) => entry.pick === SONNET)).toBe(true);
  });

  it('pins every piece to the pinned model, whatever else is connected', () => {
    const pinned = facts({ route: context('pinned'), parallel: true });
    expect(assignPieces(pieces, pinned).map((entry) => entry.pick)).toEqual(
      pieces.map(() => SONNET),
    );
  });

  it('spreads parallel pieces by size, the largest on the chat provider', () => {
    const assigned = assignPieces(pieces, facts({ parallel: true }));
    expect(providers(assigned)).toEqual([
      ['P1', 'codex'],
      ['P2', 'claude'],
      ['P3', 'claude'],
      ['R1', 'claude'],
    ]);
    const codex = assigned[0]!.pick;
    expect(codex).toMatchObject({ provider: 'codex', model: 'gpt-6-sol', modelLabel: '6 Sol' });
  });

  it('gives another provider its top tier for complex work and never its fast tier', () => {
    const sol: AgentPick = {
      provider: 'codex',
      model: 'gpt-6-sol',
      modelLabel: '6 Sol',
      effort: null,
    };
    const route = { ...context('auto'), chat: sol };
    const complex = assignPieces(
      pieces,
      facts({ route, builder: sol, parallel: true, complex: true }),
    );
    expect(complex[0]!.pick).toMatchObject({ provider: 'claude', model: 'opus[1m]' });
    const plain = assignPieces(pieces, facts({ route, builder: sol, parallel: true }));
    expect(plain[0]!.pick).toMatchObject({ provider: 'claude', model: 'sonnet' });
  });

  it('moves every piece off an unhealthy chat provider', () => {
    const assigned = assignPieces(
      pieces,
      facts({ unhealthy: new Map([['claude', 'rate limited']]) }),
    );
    expect(new Set(assigned.map((entry) => entry.pick.provider))).toEqual(new Set(['codex']));
  });

  it('stays on the chat pick when no provider is healthy', () => {
    const down = new Map([
      ['claude', 'rate limited'],
      ['codex', 'signed out'],
    ]);
    const assigned = assignPieces(pieces, facts({ unhealthy: down }));
    expect(assigned[0]).toMatchObject({ pick: SONNET });
  });

  it('prefers the stronger Builder, then the less loaded provider, among the others', () => {
    const zai: AdvisorCandidate = {
      provider: 'zai',
      name: 'Z.ai',
      models: [{ id: 'glm-5.3', label: 'GLM-5.3', description: null }],
      efforts: [],
    };
    const strongCodex = { ...candidates[1]!, stats: [stat('codex', 9, 10)] };
    const route = { ...context('auto'), candidates: [candidates[0]!, strongCodex, zai] };
    const tried = new Set(['claude']);
    expect(fallbackPick(facts({ route }), tried)?.provider).toBe('codex');
    const busy = facts({ route: { ...route, candidates: [candidates[0]!, candidates[1]!, zai] } });
    const loaded = { ...busy, load: new Map([['codex', 3]]) };
    expect(fallbackPick(loaded, tried)?.provider).toBe('zai');
  });

  it('skips providers that cannot run Builders or were already tried', () => {
    const askOnly = { ...candidates[1]!, doAvailable: false };
    const route = { ...context('auto'), candidates: [candidates[0]!, askOnly] };
    expect(fallbackPick(facts({ route }), new Set(['claude']))).toBeNull();
    expect(providerOption(facts(), 'codex')?.pick.provider).toBe('codex');
    expect(providerOption(facts({ unhealthy: new Map([['codex', 'down']]) }), 'codex')).toBeNull();
  });
});
