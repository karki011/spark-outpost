import { describe, expect, it } from 'vitest';
import { escalate, routeBuilder, routeMemberModel, type RouteContext } from './routing.ts';
import { context, plainFacts } from './route-fixtures.ts';

function withEfforts(providerEffort: string | null, chatEffort: string | null): RouteContext {
  const base = context('auto');
  return { ...base, providerEffort, chat: { ...base.chat, effort: chatEffort } };
}

describe('Builder effort', () => {
  it('runs at the provider default ahead of the chat effort', () => {
    expect(routeBuilder(withEfforts('low', 'high'), plainFacts).pick.effort).toBe('low');
  });

  it('uses the chat effort when the provider has no default', () => {
    expect(routeBuilder(withEfforts(null, 'medium'), plainFacts).pick.effort).toBe('medium');
  });

  it('falls back to the model card default when neither is set', () => {
    expect(routeBuilder(withEfforts(null, null), plainFacts).pick).toMatchObject({
      model: 'sonnet',
      effort: 'high',
    });
  });

  it('skips a provider default the provider no longer reports', () => {
    expect(routeBuilder(withEfforts('max', 'medium'), plainFacts).pick.effort).toBe('medium');
    expect(routeBuilder(withEfforts('max', 'xhigh'), plainFacts).pick.effort).toBe('high');
  });

  it('uses the card default of the model the rules picked', () => {
    const destructive = routeBuilder(withEfforts(null, null), {
      trivial: false,
      destructive: true,
    });
    expect(destructive.pick).toMatchObject({ model: 'opus[1m]', effort: 'medium' });
  });

  it('applies the provider default when the chat model is pinned', () => {
    const pinned = { ...withEfforts('low', 'high'), routing: 'pinned' as const };
    expect(routeBuilder(pinned, plainFacts)).toMatchObject({
      routedBy: 'pinned',
      pick: { model: 'sonnet', effort: 'low' },
    });
  });

  it('still escalates one step from the provider default', () => {
    const first = routeBuilder(withEfforts('low', 'high'), { trivial: true, destructive: false });
    expect(first.pick).toMatchObject({ model: 'sonnet', effort: 'low' });
    expect(escalate(withEfforts('low', 'high'), first).pick).toMatchObject({
      model: 'opus[1m]',
      effort: 'medium',
    });
  });

  it('leaves other members on the chat effort', () => {
    expect(routeMemberModel(withEfforts('low', 'high'), plainFacts).pick.effort).toBe('high');
  });
});
