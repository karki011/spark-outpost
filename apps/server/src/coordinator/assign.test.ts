import { describe, expect, it } from 'vitest';
import type { AgentPick } from '@spark-outpost/contracts';
import { candidates, context } from '../orchestration/route-fixtures.ts';
import { providerOption, type AssignFacts } from './assign.ts';

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
    ...extra,
  };
}

describe('providerOption', () => {
  it('gives the chat provider its routed Builder pick', () => {
    expect(providerOption(facts(), 'claude')).toEqual({ provider: 'claude', pick: SONNET });
  });

  it('gives a provider the user asked for its floor model, or its top tier for complex work', () => {
    expect(providerOption(facts(), 'codex')?.pick).toMatchObject({
      provider: 'codex',
      model: 'gpt-6-sol',
      modelLabel: '6 Sol',
    });
    const sol: AgentPick = {
      provider: 'codex',
      model: 'gpt-6-sol',
      modelLabel: '6 Sol',
      effort: null,
    };
    const route = { ...context('auto'), chat: sol };
    const complex = providerOption(facts({ route, builder: sol, complex: true }), 'claude');
    expect(complex?.pick).toMatchObject({ provider: 'claude', model: 'opus[1m]' });
    const plain = providerOption(facts({ route, builder: sol }), 'claude');
    expect(plain?.pick).toMatchObject({ provider: 'claude', model: 'sonnet' });
  });

  it('refuses a provider that cannot run Builders, is unhealthy or is not connected', () => {
    const askOnly = { ...candidates[1]!, doAvailable: false };
    const route = { ...context('auto'), candidates: [candidates[0]!, askOnly] };
    expect(providerOption(facts({ route }), 'codex')).toBeNull();
    expect(providerOption(facts({ unhealthy: new Map([['codex', 'down']]) }), 'codex')).toBeNull();
    expect(providerOption(facts(), 'zai')).toBeNull();
  });
});
