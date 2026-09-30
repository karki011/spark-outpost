import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentPick } from '@spark-outpost/contracts';
import type { AdvisorCandidate } from '../advisor/advice.ts';
import { whyLine } from '../model-cards/why.ts';
import type { JevCall } from './jev-calls.ts';
import type { ScanReport } from '../codescan/scan.ts';
import { complexByBreadth } from './builder-complexity.ts';
import { keepBuilderSession } from './member-routes.ts';
import { floorPick, FLOOR_REASON, floorText } from './model-floor.ts';
import { candidates, context, plainFacts } from './route-fixtures.ts';
import {
  builderTierPick,
  escalateBuilder,
  floorBuilderRoute,
  routeBuilder,
  routeCritic,
  topFamilies,
  type MemberRoute,
  type RouteContext,
} from './routing.ts';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});
import { routeVariant, variantLine } from '../routing/route-answer.ts';
import { routePolicy } from '../routing/route-policy.ts';
const claude = candidates[0]!;
const [HAIKU, SONNET, OPUS] = claude.models as [
  (typeof claude.models)[0],
  (typeof claude.models)[0],
  (typeof claude.models)[0],
];
function scanOf(packages: readonly string[]): ScanReport {
  const candidates = packages.map((pkg) => ({
    path: `${pkg}/a.ts`,
    score: 1,
    termsMatched: 1,
    package: pkg,
  }));
  return { candidates } as unknown as ScanReport;
}

const RAISED = "raised to Sonnet 5: Builders don't run on the fast tier";

function pick(model: { id: string; label: string }, effort = 'medium'): AgentPick {
  return { provider: 'claude', model: model.id, modelLabel: model.label, effort };
}

function withModels(
  chat: AgentPick,
  models: AdvisorCandidate['models'],
  routing: 'auto' | 'pinned' = 'auto',
): RouteContext {
  return { ...context(routing), chat, candidates: [{ ...claude, models }, candidates[1]!] };
}

const onHaiku = (routing: 'auto' | 'pinned' = 'auto', request?: string): RouteContext => ({
  ...context(routing),
  chat: pick(HAIKU),
  ...(request ? { request } : {}),
});

describe('the Builder floor, by tier', () => {
  it('raises a fast-tier pick to the lowest tier at or above the middle', () => {
    expect(floorPick(pick(HAIKU), claude.models)).toEqual({
      pick: pick(SONNET),
      note: { kind: 'raised', from: 'Haiku 4.5', to: 'Sonnet 5' },
    });
    expect(floorPick(pick(SONNET), claude.models)).toEqual({ pick: pick(SONNET), note: null });
    expect(floorPick(pick(OPUS), claude.models)).toEqual({ pick: pick(OPUS), note: null });
  });

  it('aims at the highest known tier for complex work', () => {
    expect(floorPick(pick(HAIKU), claude.models, { aim: 'top' }).pick.model).toBe('opus[1m]');
    expect(floorPick(pick(SONNET), claude.models, { aim: 'top' }).pick.model).toBe('opus[1m]');
  });

  it('uses the next tier up when the middle-tier model is gone', () => {
    const noMiddle = [HAIKU, OPUS];
    expect(floorPick(pick(HAIKU), noMiddle)).toMatchObject({
      pick: { model: 'opus[1m]', modelLabel: 'Opus 5.5' },
      note: { kind: 'raised', to: 'Opus 5.5' },
    });
  });

  it('keeps a brand-new model with no card or known name, and notes its tier is unknown', () => {
    const nova = { id: 'nova-1', label: 'Nova 1', description: null };
    const floored = floorPick(pick(nova), [HAIKU, nova, SONNET]);
    expect(floored.pick.model).toBe('nova-1');
    expect(floored.note).toEqual({ kind: 'tier_unknown', model: 'Nova 1' });
    expect(floorText(floored.note!)).toBe('tier unknown for Nova 1');
    expect(floorPick(pick(nova), [HAIKU, nova, OPUS], { aim: 'top' }).pick.model).toBe('opus[1m]');
  });

  it('raises a fast-tier pick to an unknown-tier model when no known stronger one exists', () => {
    const nova = { id: 'nova-1', label: 'Nova 1', description: null };
    const floored = floorPick(pick(HAIKU), [HAIKU, nova]);
    expect(floored.pick.model).toBe('nova-1');
    expect(floorText(floored.note!)).toBe(
      "raised to Nova 1: Builders don't run on the fast tier · tier unknown for Nova 1",
    );
  });

  it('keeps the pick and says why when the provider offers nothing stronger', () => {
    const floored = floorPick(pick(HAIKU), [HAIKU]);
    expect(floored.pick.model).toBe('haiku');
    expect(floorText(floored.note!)).toBe(
      'kept Haiku 4.5: no stronger model for Builders · retiring on 2026-10-15',
    );
  });

  it('leaves the agent default alone', () => {
    const agentDefault: AgentPick = { ...pick(HAIKU), model: null, modelLabel: null };
    expect(floorPick(agentDefault, claude.models)).toEqual({ pick: agentDefault, note: null });
  });
});

describe('every path that picks a Builder model', () => {
  it('raises the rule route when the chat is on the fast tier', () => {
    const route = routeBuilder(onHaiku(), plainFacts);
    expect(route).toMatchObject({ rule: 'chat model', pick: { model: 'sonnet' }, note: RAISED });
    expect(route.pick.effort).toBe('medium');
  });

  it('raises a pinned fast-tier model too', () => {
    expect(routeBuilder(onHaiku('pinned'), plainFacts)).toMatchObject({
      routedBy: 'pinned',
      pick: { model: 'sonnet' },
      note: RAISED,
    });
  });

  it('raises Jev’s tier pick, recorded or acted on', () => {
    expect(routeBuilder(context('auto'), plainFacts, 'small').autoWouldUse?.model).toBe('sonnet');
    expect(builderTierPick(context('auto'), 'small')?.model).toBe('sonnet');
    expect(builderTierPick(context('auto'), 'top')?.model).toBe('opus[1m]');
  });

  it('raises a cascade rerun from a fast-tier route and drops a stale note', () => {
    const fast: MemberRoute = {
      pick: pick(HAIKU, 'low'),
      routedBy: 'rules',
      rule: 'chat model',
      autoWouldUse: null,
      note: 'old note',
    };
    const alone = { ...context('auto'), candidates: [{ ...claude, models: [HAIKU] }] };
    const up = escalateBuilder(alone, fast);
    expect(up.pick.model).toBe('haiku');
    expect(up.note).toBe('kept Haiku 4.5: no stronger model for Builders · retiring on 2026-10-15');
    const raised = floorBuilderRoute(context('auto'), { ...fast, rule: 'kept' });
    expect(raised).toMatchObject({ pick: { model: 'sonnet' }, note: RAISED });
    expect(escalateBuilder(context('auto'), raised).note).toBe(undefined);
  });

  it('does not resume a fast-tier Builder session', () => {
    const route = routeBuilder(context('auto'), plainFacts);
    const kept = keepBuilderSession(route, { pick: pick(HAIKU), contextTokens: 1 }, null);
    expect(kept.route.pick.model).toBe('sonnet');
    expect(kept.choice).toMatchObject({ kept: false, reason: FLOOR_REASON });
    const sonnet = keepBuilderSession(route, { pick: pick(SONNET, 'low'), contextTokens: 1 }, null);
    expect(sonnet.choice).toMatchObject({ kept: true });
    const complex = keepBuilderSession(
      { ...route, pick: pick(OPUS) },
      { pick: pick(SONNET), contextTokens: 1 },
      'complex work (migration) needs the top tier',
    );
    expect(complex).toMatchObject({
      route: { pick: { model: 'opus[1m]' } },
      choice: {
        kept: false,
        reason:
          'complex work (migration) needs the top tier; left the resumable Sonnet 5 session (under 1K context)',
      },
    });
  });

  it('raises the shadow route’s code pick and Jev’s route answer', () => {
    expect(routePolicy(onHaiku(), plainFacts, false)).toMatchObject({
      kind: 'no_jev',
      chat: { model: 'haiku' },
      codePick: { model: 'sonnet' },
      rule: { pick: { model: 'sonnet' } },
    });
    const policy = routePolicy(context('auto'), plainFacts, true);
    const call: JevCall = {
      status: 'answered',
      asked: null,
      response: {
        answers: {
          route: {
            type: 'choice',
            choice: 'claude/haiku',
            confidence: 0.98,
            probabilities: { 'claude/haiku': 0.98, 'claude/sonnet': 0.02 },
          },
        },
      } as unknown as NonNullable<JevCall['response']>,
      error: null,
      latencyMs: 100,
      usage: null,
      model: 'jev',
    };
    const variant = routeVariant(call, policy, context('auto'));
    expect(variant.pick.model).toBe('haiku');
    expect(variant.raisedTo?.model).toBe('sonnet');
    expect(variantLine('text-only', variant)).toBe(
      'Jev text-only Haiku 4.5 (chose 0.98, raised to Sonnet 5)',
    );
    expect(variant.selection?.candidateId).toBe('claude/haiku');
  });

  it('puts Critics on the middle tier when the chat is on the fast tier', () => {
    const critic = routeCritic({ ...onHaiku(), candidates: [claude] }).pick;
    expect(critic.model).toBe('sonnet');
  });

  it('puts the note in the why line', () => {
    const route = routeBuilder(onHaiku(), plainFacts);
    expect(whyLine(route)).toBe(`Why Sonnet 5: rule chat model · mid tier · ${RAISED}`);
  });
});

describe('complex work goes to the top tier', () => {
  it('uses the middle tier for everyday work', () => {
    expect(
      routeBuilder(onHaiku('auto', 'add a total row to the report'), plainFacts).pick.model,
    ).toBe('sonnet');
  });

  it.each([
    ['write a migration that adds a currency column', 'migration'],
    ['fix the login redirect so sessions expire', 'security'],
    ['rename the logger across all packages', 'multi-package'],
    ['use the strongest model to redesign parsing', 'asked for the top model'],
    ['please use opus for this one', 'asked for the top model'],
  ])('%s → top tier (%s)', (request, reason) => {
    const route = routeBuilder(onHaiku('auto', request), plainFacts);
    expect(route).toMatchObject({
      rule: `complex → top tier (${reason})`,
      pick: { model: 'opus[1m]' },
    });
    expect(route.note).toBeUndefined();
  });

  it('takes the scan and confident Jev signals through the facts', () => {
    const scan = { source: 'scan' as const, reason: 'matches in 4 packages' };
    expect(routeBuilder(context('auto'), { ...plainFacts, complex: scan })).toMatchObject({
      rule: 'complex → top tier (matches in 4 packages)',
      pick: { model: 'opus[1m]' },
    });
  });

  it('routes the dev-day typo (s05) to the middle tier despite broad scan matches', () => {
    const request =
      'Typo on the Analytics Spend tab: the source line says "was reportd by providers". Fix it.';
    const breadth = complexByBreadth(
      scanOf(['apps/web', 'packages/contracts', 'apps/server', 'root']),
      request,
      { tier: 'small', routeConfidence: 1 },
    );
    const route = routeBuilder(
      onHaiku('auto', request),
      { trivial: true, destructive: false, complex: breadth.complex, setAside: breadth.setAside! },
      'small',
    );
    expect(route).toMatchObject({
      rule: 'trivial → middle tier (matches in 4 packages set aside: one-line fix)',
      pick: { model: 'sonnet' },
    });
    expect(route.note).toBeUndefined();
  });

  it('routes the dev-day rounding bug (s06) to the middle tier on the chat model', () => {
    const request =
      'Bug: on Analytics a share of 2 out of 3 shows as 66%, but it should round to the nearest percent (67%). Fix it.';
    const breadth = complexByBreadth(
      scanOf(['apps/web', 'packages/contracts', 'apps/server']),
      request,
      { tier: 'mid', routeConfidence: 0.9 },
    );
    const route = routeBuilder(context('auto'), { ...plainFacts, complex: breadth.complex }, 'mid');
    expect(route).toMatchObject({ rule: 'chat model', pick: { model: 'sonnet' } });
  });

  it('keeps destructive wording and a pinned model as they are', () => {
    const request = 'drop the legacy table in a migration';
    expect(routeBuilder(onHaiku('auto', request), { ...plainFacts, destructive: true }).rule).toBe(
      'destructive → top tier',
    );
    expect(routeBuilder(onHaiku('pinned', 'write a migration'), plainFacts)).toMatchObject({
      routedBy: 'pinned',
      pick: { model: 'sonnet' },
    });
  });

  it('reads the top model’s family from the current model list', () => {
    expect(topFamilies(context('auto'))).toEqual(['Opus']);
    const codex = { ...context('auto'), chat: { ...context('auto').chat, provider: 'codex' } };
    expect(topFamilies(codex)).toEqual(['Sol']);
    expect(topFamilies(withModels(pick(SONNET), [HAIKU, SONNET]))).toEqual(['Sonnet']);
    const shared = withModels(pick(SONNET), [
      { id: 'flash', label: 'GLM-5.3-Flash', description: null },
      { id: 'full', label: 'GLM-5.3', description: null },
    ]);
    expect(topFamilies(shared)).toEqual([]);
  });
});
