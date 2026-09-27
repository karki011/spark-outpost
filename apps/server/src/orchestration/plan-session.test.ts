import { describe, expect, it } from 'vitest';
import type { AgentPick } from '@spark-outpost/contracts';
import {
  PLAN_SESSION_REASONS,
  continuedPick,
  decidePlanSession,
  type PlanSessionInput,
} from './plan-session.ts';
import type { MemberRoute } from './routing.ts';

const sonnetHigh: AgentPick = {
  provider: 'claude',
  model: 'sonnet',
  modelLabel: 'Sonnet 5',
  effort: 'high',
};
const sonnetMedium: AgentPick = { ...sonnetHigh, effort: 'medium' };
const opusHigh: AgentPick = { ...sonnetHigh, model: 'opus[1m]', modelLabel: 'Opus 5.5' };
const haikuLow: AgentPick = {
  ...sonnetHigh,
  model: 'haiku',
  modelLabel: 'Haiku 4.5',
  effort: 'low',
};

function builder(pick: AgentPick, routedBy: MemberRoute['routedBy'] = 'rules'): MemberRoute {
  return { pick, routedBy, autoWouldUse: null, gate: null };
}

function input(overrides: Partial<PlanSessionInput> = {}): PlanSessionInput {
  return {
    builderSpans: 1,
    lanes: 0,
    largeSteps: 1,
    changedFiles: 3,
    complexity: 1.4,
    architect: sonnetHigh,
    builder: builder(sonnetMedium),
    contextTokens: 30_000,
    ...overrides,
  };
}

describe('plan and build in one session', () => {
  it('continues the Architect when one Builder of the same model carries a small plan', () => {
    const choice = decidePlanSession(input());
    expect(choice).toMatchObject({ same: true, reason: PLAN_SESSION_REASONS.oneBuilder });
    expect(continuedPick(sonnetHigh, sonnetMedium)).toEqual(sonnetMedium);
  });

  it('keeps separate Builders for lanes, several spans and large plans', () => {
    expect(decidePlanSession(input({ lanes: 2 })).reason).toBe(
      PLAN_SESSION_REASONS.severalBuilders,
    );
    expect(decidePlanSession(input({ builderSpans: 2 })).same).toBe(false);
    expect(decidePlanSession(input({ largeSteps: 3 })).reason).toBe(PLAN_SESSION_REASONS.large);
    expect(decidePlanSession(input({ changedFiles: 8 })).reason).toBe(PLAN_SESSION_REASONS.large);
    expect(decidePlanSession(input({ complexity: 2.6 })).reason).toBe(PLAN_SESSION_REASONS.large);
    expect(decidePlanSession(input({ complexity: null })).same).toBe(true);
  });

  it('starts a fresh Builder when Jev or the user picked another Builder model', () => {
    expect(decidePlanSession(input({ builder: builder(haikuLow, 'jev') })).reason).toBe(
      PLAN_SESSION_REASONS.jevModel,
    );
    expect(decidePlanSession(input({ builder: builder(haikuLow, 'pinned') })).reason).toBe(
      PLAN_SESSION_REASONS.pinnedModel,
    );
    const codex = { provider: 'codex', model: 'gpt-6-sol', modelLabel: '6 Sol', effort: 'medium' };
    expect(decidePlanSession(input({ builder: builder(codex) })).reason).toBe(
      PLAN_SESSION_REASONS.provider,
    );
  });

  it('weighs the re-read against the cheaper rule Builder when the models differ', () => {
    const cheap = decidePlanSession(
      input({ architect: opusHigh, builder: builder(sonnetMedium), contextTokens: 5_000 }),
    );
    expect(cheap).toMatchObject({ same: false, reason: PLAN_SESSION_REASONS.cheaperBuilder });
    expect(cheap.savingUsd).toBeCloseTo(0.06, 5);
    const reread = decidePlanSession(
      input({ architect: opusHigh, builder: builder(sonnetMedium), contextTokens: 80_000 }),
    );
    expect(reread).toMatchObject({ same: true, reason: PLAN_SESSION_REASONS.cheaperReread });
    expect(reread.cacheLossUsd).toBeCloseTo(0.144, 5);
  });

  it('never downgrades a stronger Builder the rules picked', () => {
    const choice = decidePlanSession(
      input({ architect: sonnetHigh, builder: builder({ ...opusHigh, effort: 'medium' }) }),
    );
    expect(choice).toMatchObject({ same: false, reason: PLAN_SESSION_REASONS.stronger });
  });
});
