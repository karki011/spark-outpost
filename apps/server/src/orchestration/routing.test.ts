import { describe, expect, it } from 'vitest';
import {
  criticProvider,
  escalate,
  jevTierPick,
  rereviewCritic,
  smallDiffCritic,
  SMALL_DIFF_NOTE,
  routeBuilder,
  routeCritic,
  type MemberRoute,
} from './routing.ts';
import { candidates, context, plainFacts } from './route-fixtures.ts';
import { escalatedEffort } from './tiers.ts';

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

  it('uses the chat model on Auto, the middle tier for trivial work and the top tier for destructive', () => {
    expect(routeBuilder(context('auto'), plainFacts)).toMatchObject({
      routedBy: 'rules',
      rule: 'chat model',
      pick: { model: 'sonnet' },
    });
    expect(routeBuilder(context('auto'), { trivial: true, destructive: false })).toMatchObject({
      rule: 'trivial → middle tier',
      pick: { model: 'sonnet', modelLabel: 'Sonnet 5' },
    });
    expect(
      routeBuilder(context('auto'), { trivial: true, destructive: false }).note,
    ).toBeUndefined();
    expect(routeBuilder(context('auto'), { trivial: true, destructive: true })).toMatchObject({
      rule: 'destructive → top tier',
      pick: { model: 'opus[1m]' },
    });
  });

  it('records Jev’s tier pick without ever running it', () => {
    const route = routeBuilder(context('auto'), plainFacts, 'top');
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

  it('re-reviews a fix at medium effort on the same Critic', () => {
    const first = routeCritic(context('auto'));
    const again = rereviewCritic(context('auto'), first);
    expect(again.pick).toEqual({ ...first.pick, effort: 'medium' });
    expect(rereviewCritic(context('auto'), again)).toBe(again);
    const low: MemberRoute = { ...first, pick: { ...first.pick, effort: 'low' } };
    expect(rereviewCritic(context('auto'), low)).toBe(low);
  });

  it('runs the first review of a small diff at medium effort and says why (live run 4)', () => {
    const first = routeCritic(context('auto'));
    const small = smallDiffCritic(context('auto'), first);
    expect(small.pick).toEqual({ ...first.pick, effort: 'medium' });
    expect(small.note).toBe(SMALL_DIFF_NOTE);
    expect(smallDiffCritic(context('auto'), small)).toBe(small);
  });

  it('sends the Critic to a provider that built no piece, else the smallest share', () => {
    const zai = { ...candidates[0]!, provider: 'zai' as const, name: 'Z.ai' };
    const three = { ...context('auto'), candidates: [...candidates, zai] };
    const pieces = [
      { provider: 'claude', files: 3 },
      { provider: 'codex', files: 1 },
    ];
    expect(criticProvider(three, pieces)).toBe('zai');
    expect(criticProvider(context('auto'), pieces)).toBe('codex');
    expect(criticProvider(context('auto'), [{ provider: 'codex', files: 4 }])).toBe('claude');
    expect(criticProvider(context('auto'), [{ provider: 'claude', files: 2 }])).toBe('codex');
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
