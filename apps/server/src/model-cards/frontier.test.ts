import { describe, expect, it } from 'vitest';
import type { AdvisorCandidate } from '../advisor/advice.ts';
import { selectableModels } from '../advisor/intake-questions.ts';
import { planShape, routeArchitect } from '../orchestration/architect-route.ts';
import { candidates, context } from '../orchestration/route-fixtures.ts';
import {
  escalate,
  routeCritic,
  routeWorker,
  type JevPick,
  type RouteContext,
} from '../orchestration/routing.ts';
import { frontierRecord, whyLine } from './why.ts';

const fable = { id: 'claude-fable-5-1[1m]', label: 'Fable 5.1', description: null };
const withFrontier = (claudeAllowed: boolean, codexAllowed: boolean): AdvisorCandidate[] => [
  { ...candidates[0]!, models: [...candidates[0]!.models, fable], allowFrontier: claudeAllowed },
  { ...candidates[1]!, allowFrontier: codexAllowed },
];
const routeContext = (risk: RouteContext['risk'] = 'edits'): RouteContext => ({
  ...context('auto'),
  candidates: withFrontier(false, true),
  risk,
});
const pick = (
  provider: string,
  model: string,
  modelLabel: string,
  confidence: number,
): JevPick => ({
  pick: { provider, model, modelLabel, effort: 'high' },
  confidence,
});

describe('frontier models', () => {
  it('are offered to Jev per provider: 6 Astra when Codex allows it, never Fable when Claude does not', () => {
    const [claude, codex] = withFrontier(false, true);
    expect(selectableModels(claude!).map((model) => model.id)).not.toContain(fable.id);
    expect(selectableModels(codex!).map((model) => model.id)).toContain('gpt-6-astra');
    expect(selectableModels({ ...codex!, allowFrontier: false }).map((model) => model.id)).toEqual([
      'gpt-6-luna',
      'gpt-6-sol',
    ]);
  });

  it('act only at 0.90, at every risk, even on read-only work', () => {
    for (const risk of ['read-only', 'edits', 'multi-file'] as const) {
      const below = routeWorker(routeContext(risk), pick('claude', fable.id, 'Fable 5.1', 0.89));
      expect(below).toMatchObject({
        routedBy: 'rules',
        gate: { actAt: 0.9, decision: 'fallback' },
      });
      expect(below.pick.model).toBe('sonnet');
      const at = routeWorker(routeContext(risk), pick('claude', fable.id, 'Fable 5.1', 0.9));
      expect(at).toMatchObject({ routedBy: 'jev', pick: { model: fable.id } });
    }
  });

  it('keep the Codex Critic on 6 Sol unless Jev is at 0.90', () => {
    const critic = (confidence: number) =>
      routeCritic(routeContext(), pick('codex', 'gpt-6-astra', '6 Astra', confidence));
    expect(critic(0.89)).toMatchObject({ routedBy: 'rules', pick: { model: 'gpt-6-sol' } });
    expect(critic(0.9)).toMatchObject({ routedBy: 'jev', pick: { model: 'gpt-6-astra' } });
  });

  it('never replace Opus as the Architect rule pick, and destructive work keeps Opus', () => {
    const vague = planShape(0, null);
    const multi = { ...routeContext('multi-file'), level: 'full-auto' as const };
    const fablePick = pick('claude', fable.id, 'Fable 5.1', 0.97);
    expect(routeArchitect(multi, vague, fablePick)).toMatchObject({
      routedBy: 'jev',
      rulePick: { model: 'opus[1m]' },
      pick: { model: fable.id },
    });
    expect(routeArchitect(multi, vague, { ...fablePick, confidence: 0.88 })).toMatchObject({
      routedBy: 'rules',
      pick: { model: 'opus[1m]' },
      gate: { actAt: 0.9 },
    });
    expect(routeArchitect({ ...multi, risk: 'destructive' }, vague, fablePick).pick.model).toBe(
      'opus[1m]',
    );
  });

  it('are never reached by escalation', () => {
    const top = routeWorker(
      {
        ...routeContext(),
        chat: { provider: 'claude', model: 'opus[1m]', modelLabel: 'Opus 5.5', effort: 'high' },
      },
      null,
    );
    expect(escalate(routeContext(), top).pick.model).toBe('opus[1m]');
  });

  it('are recorded with the gate and explained in the why line', () => {
    const context = routeContext();
    const jev = pick('claude', fable.id, 'Fable 5.1', 0.86);
    const route = routeWorker(context, jev);
    const input = {
      pick: route.pick,
      routedBy: route.routedBy,
      jevPick: route.autoWouldUse,
      gate: route.gate,
      rule: 'rules',
      candidate: context.candidates[0],
    };
    expect(frontierRecord(input)).toEqual({
      provider: 'claude',
      allowed: false,
      offered: false,
      picked: true,
    });
    expect(whyLine(input)).toBe(
      'Why Sonnet 5: rule rules · mid tier · Jev picked Fable 5.1 at 0.86 · frontier needs 0.90 · frontier off',
    );
    expect(
      whyLine({
        ...input,
        routedBy: 'jev',
        pick: jev.pick,
        gate: { ...route.gate!, confidence: 0.97 },
      }),
    ).toBe('Why Fable 5.1: Jev 0.97 · frontier tier · frontier off');
  });
});
