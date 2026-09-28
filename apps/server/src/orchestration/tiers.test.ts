import { describe, expect, it } from 'vitest';
import type { AdvisorCandidate } from '../advisor/advice.ts';
import { ZAI_MODELS } from '../agents/acp/zai.ts';
import { candidates, context } from './route-fixtures.ts';
import { escalate, routeBuilder, ruleCriticPick, type RouteContext } from './routing.ts';
import { modelTier, oneTierUp, tierLadder, topTier } from './tiers.ts';

const glm = ZAI_MODELS.map((model) => ({
  id: model.slot,
  label: model.label,
  description: model.description,
}));
const zai: AdvisorCandidate = {
  provider: 'zai',
  name: 'Z.ai (GLM)',
  models: glm,
  efforts: ['low', 'high', 'max'].map((id) => ({ id, label: id, description: null })),
};

describe('GLM tiers', () => {
  it('ranks GLM models from the table, by label or by bare id', () => {
    expect(modelTier({ id: 'haiku', label: 'GLM-5.3-Flash' })).toBe(0);
    expect(modelTier({ id: 'opus', label: 'GLM-5.3' })).toBe(2);
    expect(modelTier({ id: 'glm-5.3-flash[1m]', label: '' })).toBe(0);
    expect(modelTier({ id: 'glm-5.3', label: '' })).toBe(2);
    expect(modelTier({ id: 'glm-9', label: 'GLM-9' })).toBeNull();
  });

  it('builds a Flash-to-5.3 ladder, so escalation and the top pick work', () => {
    expect(tierLadder(glm).map((model) => model.label)).toEqual(['GLM-5.3-Flash', 'GLM-5.3']);
    expect(topTier(glm)?.label).toBe('GLM-5.3');
    expect(oneTierUp(glm, 'haiku')?.label).toBe('GLM-5.3');
    expect(oneTierUp(glm, 'opus')).toBeNull();
  });

  it('describes each GLM model with its strengths and price for Jev', () => {
    for (const model of glm) expect(model.description).toMatch(/\$\d.*per million tokens/);
  });
});

describe('routing with Z.ai connected', () => {
  const withZai = (chat: RouteContext['chat']): RouteContext => ({
    ...context('auto'),
    chat,
    candidates: [...candidates, zai],
  });

  it('keeps the Critic on Codex when Codex is also connected', () => {
    const route = withZai({
      provider: 'claude',
      model: 'sonnet',
      modelLabel: null,
      effort: 'high',
    });
    expect(ruleCriticPick(route).provider).toBe('codex');
  });

  it('uses GLM-5.3 as the cross-provider Critic when only Claude and Z.ai are connected', () => {
    const route: RouteContext = {
      ...withZai({ provider: 'claude', model: 'sonnet', modelLabel: null, effort: 'high' }),
      candidates: [candidates[0]!, zai],
    };
    expect(ruleCriticPick(route)).toMatchObject({ provider: 'zai', modelLabel: 'GLM-5.3' });
  });

  it('escalates a GLM-5.3-Flash Builder to GLM-5.3', () => {
    const route = withZai({
      provider: 'zai',
      model: 'haiku',
      modelLabel: 'GLM-5.3-Flash',
      effort: 'low',
    });
    const first = routeBuilder(route, { trivial: false, destructive: false });
    expect(escalate(route, first).pick).toMatchObject({
      provider: 'zai',
      model: 'opus',
      modelLabel: 'GLM-5.3',
      effort: 'high',
    });
  });

  it('raises trivial edits past GLM-5.3-Flash to GLM-5.3, and records Jev’s tier only', () => {
    const route = withZai({
      provider: 'zai',
      model: 'opus',
      modelLabel: 'GLM-5.3',
      effort: 'high',
    });
    const trivial = routeBuilder(
      { ...route, routing: 'auto' },
      { trivial: true, destructive: false },
    );
    expect(trivial.pick).toMatchObject({ model: 'opus', modelLabel: 'GLM-5.3' });
    expect(trivial.note).toBe("raised to GLM-5.3: Builders don't run on the fast tier");
    const observed = routeBuilder(route, { trivial: false, destructive: false }, 'small');
    expect(observed.pick).toMatchObject({ model: 'opus' });
    expect(observed.autoWouldUse).toMatchObject({ model: 'opus', modelLabel: 'GLM-5.3' });
  });
});
