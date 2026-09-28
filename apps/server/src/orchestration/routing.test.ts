import { describe, expect, it } from 'vitest';
import {
  criticProvider,
  escalate,
  jevTierPick,
  routeBuilder,
  routeCritic,
  type MemberRoute,
} from './routing.ts';
import { candidates, context } from './route-fixtures.ts';
import { escalatedEffort } from './tiers.ts';

const plain = { trivial: false, destructive: false };

describe('rule routes', () => {
  it('keeps a pinned model whatever the rules or Jev say', () => {
    expect(
      routeBuilder(context('pinned'), { trivial: true, destructive: true }, 'small'),
    ).toMatchObject({
      routedBy: 'pinned',
      pick: { model: 'sonnet' },
      autoWouldUse: { model: 'sonnet' },
    });
  });

  it('uses the chat model on Auto, the small tier for trivial work and the top tier for destructive', () => {
    expect(routeBuilder(context('auto'), plain)).toMatchObject({
      routedBy: 'rules',
      rule: 'chat model',
      pick: { model: 'sonnet' },
    });
    expect(routeBuilder(context('auto'), { trivial: true, destructive: false })).toMatchObject({
      rule: 'trivial → small tier',
      pick: { model: 'sonnet', modelLabel: 'Sonnet 5' },
      note: "raised to Sonnet 5: Builders don't run on the fast tier",
    });
    expect(routeBuilder(context('auto'), { trivial: true, destructive: true })).toMatchObject({
      rule: 'destructive → top tier',
      pick: { model: 'opus[1m]' },
    });
  });

  it('records Jev’s tier pick without ever running it', () => {
    const route = routeBuilder(context('auto'), plain, 'top');
    expect(route.pick.model).toBe('sonnet');
    expect(route.autoWouldUse).toMatchObject({ model: 'opus[1m]', modelLabel: 'Opus 5.5' });
    expect(jevTierPick(context('auto'), null)).toBeNull();
  });

  it('sends the Critic to the other connected provider', () => {
    expect(criticProvider(context('auto'))).toBe('codex');
    expect(routeCritic(context('auto')).pick).toMatchObject({
      provider: 'codex',
      model: 'gpt-6-sol',
      effort: 'high',
    });
    const alone = { ...context('auto'), candidates: [candidates[0]!] };
    const pick = routeCritic(alone).pick;
    expect(pick.provider).toBe('claude');
    expect(pick.model).not.toBe(alone.chat.model);
    expect(pick.effort).toBe('high');
  });

  it('escalates the previous pick one tier up, then raises effort', () => {
    const haiku = { provider: 'claude', model: 'haiku', modelLabel: 'Haiku 4.5', effort: 'low' };
    const first: MemberRoute = { pick: haiku, routedBy: 'rules', rule: 'x', autoWouldUse: null };
    const second = escalate(context('auto'), first);
    expect(second.pick).toMatchObject({
      model: 'sonnet',
      modelLabel: 'Sonnet 5',
      effort: 'medium',
    });
    const third = escalate(context('auto'), second);
    expect(third.pick).toMatchObject({ model: 'opus[1m]', effort: 'medium' });
    expect(escalate(context('auto'), third).pick).toMatchObject({
      model: 'opus[1m]',
      effort: 'high',
    });
  });

  it('raises a low effort to at least medium when escalating, and keeps a higher one', () => {
    const at = (effort: string): MemberRoute => ({
      pick: { provider: 'claude', model: 'sonnet', modelLabel: 'Sonnet 5', effort },
      routedBy: 'rules',
      rule: 'chat model',
      autoWouldUse: null,
    });
    expect(escalate(context('auto'), at('low')).pick).toMatchObject({
      model: 'opus[1m]',
      effort: 'medium',
    });
    expect(escalate(context('auto'), at('medium')).pick.effort).toBe('medium');
    expect(escalate(context('auto'), at('high')).pick.effort).toBe('high');
  });

  it('escalates the effort to the first one at or above medium the provider offers', () => {
    expect(escalatedEffort(['low', 'high', 'max'], 'low')).toBe('high');
    expect(escalatedEffort(['low', 'medium'], 'xhigh')).toBe('xhigh');
    expect(escalatedEffort(['low'], 'low')).toBe('low');
    expect(escalatedEffort(['low', 'medium'], null)).toBe('medium');
  });
});
