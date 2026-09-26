import { describe, expect, it } from 'vitest';
import type { SystemOneResponse } from '../advisor/intake-questions.ts';
import {
  criticProvider,
  escalate,
  intakePickFor,
  notPricier,
  routeCritic,
  routeWorker,
  type MemberRoute,
} from './routing.ts';
import { candidates, context } from './route-fixtures.ts';
import { escalatedEffort } from './tiers.ts';

const response = (confidence: number): SystemOneResponse => ({
  model: 'jev',
  answers: {
    model_claude: { type: 'choice', choice: 'haiku', probabilities: {}, confidence },
    effort_claude: { type: 'score', score: 0, confidence: 0.9 },
  },
});

describe('the routing gate', () => {
  it("uses Jev's pick on Auto only when the gate acts", () => {
    const pick = intakePickFor(context('auto'), 'claude', response(0.95));
    expect(routeWorker(context('auto'), pick)).toMatchObject({
      routedBy: 'jev',
      pick: { model: 'haiku', effort: 'low', modelLabel: 'Haiku 4.5' },
      gate: { decision: 'act' },
    });
    const unsure = intakePickFor(context('auto'), 'claude', response(0.3));
    expect(routeWorker(context('auto'), unsure)).toMatchObject({
      routedBy: 'rules',
      pick: { model: 'sonnet', modelLabel: 'Sonnet 5' },
      autoWouldUse: { model: 'haiku', effort: 'low' },
      gate: { decision: 'fallback' },
    });
  });

  it('keeps the pinned model and records what Auto would have used', () => {
    const pick = intakePickFor(context('pinned'), 'claude', response(0.95));
    expect(routeWorker(context('pinned'), pick)).toMatchObject({
      routedBy: 'pinned',
      pick: { model: 'sonnet' },
      autoWouldUse: { model: 'haiku', effort: 'low' },
    });
  });

  it('uses the rules without Jev', () => {
    expect(routeWorker(context('auto'), null)).toMatchObject({
      routedBy: 'rules',
      pick: { model: 'sonnet' },
    });
  });

  it('acts on a cheaper pick at 0.8 for edits, but keeps 0.9 for upgrades and multi-file', () => {
    const cheaper = intakePickFor(context('auto'), 'claude', response(0.84));
    expect(routeWorker(context('full-auto'), cheaper)).toMatchObject({
      routedBy: 'jev',
      pick: { model: 'haiku' },
      gate: { actAt: 0.8, decision: 'act' },
    });
    const multi = { ...context('full-auto'), risk: 'multi-file' as const };
    expect(routeWorker(multi, cheaper)).toMatchObject({
      routedBy: 'rules',
      pick: { model: 'sonnet' },
      autoWouldUse: { model: 'haiku' },
      gate: { actAt: 0.9, decision: 'fallback' },
    });
    const opus = {
      pick: { provider: 'claude', model: 'opus[1m]', modelLabel: 'Opus 5.5', effort: 'medium' },
      confidence: 0.84,
    };
    expect(routeWorker(context('full-auto'), opus)).toMatchObject({
      routedBy: 'rules',
      autoWouldUse: { model: 'opus[1m]' },
      gate: { actAt: 0.9 },
    });
    const harder = { ...opus, pick: { ...opus.pick, model: 'sonnet', effort: 'high' } };
    expect(notPricier(harder.pick, context('auto').chat)).toBe(false);
  });

  it('sends the Critic to the other connected provider', () => {
    expect(criticProvider(context('auto'))).toBe('codex');
    expect(routeCritic(context('auto'), null).pick).toMatchObject({
      provider: 'codex',
      model: 'gpt-6-sol',
      effort: 'high',
    });
    const alone = { ...context('auto'), candidates: [candidates[0]!] };
    expect(routeCritic(alone, null).pick).toMatchObject({ provider: 'claude', effort: 'high' });
  });

  it('escalates the previous pick one tier up', () => {
    const first = routeWorker(
      context('auto'),
      intakePickFor(context('auto'), 'claude', response(0.95)),
    );
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
      routedBy: 'jev',
      autoWouldUse: null,
      gate: null,
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
