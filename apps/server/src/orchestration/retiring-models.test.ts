import { describe, expect, it } from 'vitest';
import type { AgentPick } from '@spark-outpost/contracts';
import type { AdvisorCandidate } from '../advisor/advice.ts';
import { cardById, cardRetiring } from '../model-cards/cards.ts';
import type { RoutingLabelRow } from '../persistence/routing-labels.ts';
import { toLabel } from '../routing/labels.ts';
import { routeVariant } from '../routing/route-answer.ts';
import { routePolicy } from '../routing/route-policy.ts';
import type { JevCall } from './jev-calls.ts';
import { keepScoutSession } from './member-routes.ts';
import { floorModel, floorPick, floorText, harnessModels } from './model-floor.ts';
import { candidates, context, plainFacts } from './route-fixtures.ts';
import {
  escalate,
  routeBuilder,
  routeCritic,
  routeMemberModel,
  type RouteContext,
} from './routing.ts';

const TODAY = new Date('2026-09-28T12:00:00Z');
const BEFORE_WINDOW = new Date('2026-08-01T12:00:00Z');
const AFTER_RETIREMENT = new Date('2026-10-20T12:00:00Z');
const claude = candidates[0]!;
const [HAIKU, SONNET] = claude.models as [
  (typeof claude.models)[0],
  (typeof claude.models)[0],
  (typeof claude.models)[0],
];

const codexModels = [
  { id: 'gpt-5.5', label: 'GPT-5.5', description: null },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', description: null },
  { id: 'gpt-6-luna', label: '6 Luna', description: null },
  { id: 'gpt-6-sol', label: '6 Sol', description: null },
];
const codex: AdvisorCandidate = { ...candidates[1]!, models: codexModels };

function pick(
  model: { id: string; label: string },
  provider = 'claude',
  effort: string | null = 'medium',
): AgentPick {
  return { provider, model: model.id, modelLabel: model.label, effort };
}

function onChat(
  chat: AgentPick,
  routing: 'auto' | 'pinned' = 'auto',
  now: Date = TODAY,
): RouteContext {
  return { ...context(routing), chat, candidates: [claude, codex], now };
}

describe('retiring models', () => {
  it('counts a model as retiring from 30 days before its date', () => {
    const haiku = cardById('claude-haiku-4-5')!;
    expect(cardRetiring(haiku, new Date('2026-09-15T00:00:00Z'))).toBe(true);
    expect(cardRetiring(haiku, new Date('2026-09-14T00:00:00Z'))).toBe(false);
    expect(cardRetiring(cardById('claude-sonnet-5')!, TODAY)).toBe(false);
  });

  it('leaves retiring models out of what the harness may pick', () => {
    expect(harnessModels(claude.models, 'claude', TODAY).map((model) => model.id)).toEqual([
      'sonnet',
      'opus[1m]',
    ]);
    expect(harnessModels(codexModels, 'codex', TODAY).map((model) => model.id)).toEqual([
      'gpt-5.6-sol',
      'gpt-6-luna',
      'gpt-6-sol',
    ]);
    expect(harnessModels(codexModels, 'codex', BEFORE_WINDOW)).toHaveLength(4);
  });

  it('resolves the middle tier from the live list, whatever the small model', () => {
    expect(floorModel(claude.models, 'claude', TODAY)?.id).toBe('sonnet');
    expect(floorModel(claude.models, 'claude', BEFORE_WINDOW)?.id).toBe('sonnet');
    expect(floorModel(codexModels, 'codex', TODAY)?.id).toBe('gpt-6-sol');
    expect(floorModel([HAIKU], 'claude', TODAY)).toBeNull();
  });

  it('keeps a retiring small model only when nothing else is offered, and says so', () => {
    const floored = floorPick(pick(HAIKU), [HAIKU], { now: TODAY });
    expect(floored.pick.model).toBe('haiku');
    expect(floorText(floored.note!, 'reader')).toBe(
      'kept Haiku 4.5: nothing stronger · retiring on 2026-10-15',
    );
  });

  it('maps a retiring model above the fast tier to the middle tier', () => {
    const gpt55 = pick(codexModels[0]!, 'codex');
    const floored = floorPick(gpt55, codexModels, { now: TODAY });
    expect(floored.pick.model).toBe('gpt-6-sol');
    expect(floorText(floored.note!)).toBe('raised to 6 Sol: GPT-5.5 retires on 2026-10-14');
    expect(floorPick(gpt55, codexModels, { now: BEFORE_WINDOW }).note).toBeNull();
    expect(floorPick(gpt55, codexModels, { aim: 'top', now: TODAY }).pick.model).toBe(
      'gpt-5.6-sol',
    );
  });

  it('treats a retired model like a retiring one, and says retired', () => {
    expect(harnessModels(claude.models, 'claude', AFTER_RETIREMENT)).toEqual(
      harnessModels(claude.models, 'claude', TODAY),
    );
    const gpt55 = floorPick(pick(codexModels[0]!, 'codex'), codexModels, {
      now: AFTER_RETIREMENT,
    });
    expect(gpt55.pick.model).toBe('gpt-6-sol');
    expect(floorText(gpt55.note!)).toBe('raised to 6 Sol: GPT-5.5 retired on 2026-10-14');
    const kept = floorPick(pick(HAIKU), [HAIKU], { now: AFTER_RETIREMENT });
    expect(floorText(kept.note!, 'reader')).toBe(
      'kept Haiku 4.5: nothing stronger · retired on 2026-10-15',
    );
    const pinned = onChat(pick(HAIKU), 'pinned', AFTER_RETIREMENT);
    expect(routeMemberModel(pinned, plainFacts).note).toBe('Haiku 4.5 retired on 2026-10-15');
  });
});

describe('read-only roles on the middle tier', () => {
  it('runs a Scout on the middle tier when the harness chooses', () => {
    expect(routeMemberModel(onChat(pick(HAIKU)), plainFacts)).toMatchObject({
      routedBy: 'rules',
      rule: 'chat model',
      pick: { model: 'sonnet', modelLabel: 'Sonnet 5' },
      note: "raised to Sonnet 5: the harness doesn't use the fast tier",
    });
    const luna = routeMemberModel(onChat(pick(codexModels[2]!, 'codex')), plainFacts);
    expect(luna.pick.model).toBe('gpt-6-sol');
    const sonnet = routeMemberModel(onChat(pick(SONNET)), plainFacts);
    expect(sonnet.pick.model).toBe('sonnet');
    expect(sonnet.note).toBeUndefined();
  });

  it('runs a model the user picked for the chat, with a retiring note', () => {
    expect(routeMemberModel(onChat(pick(HAIKU), 'pinned'), plainFacts)).toMatchObject({
      routedBy: 'pinned',
      pick: { model: 'haiku' },
      note: 'Haiku 4.5 retiring on 2026-10-15',
    });
    expect(routeMemberModel(onChat(pick(SONNET), 'pinned'), plainFacts).note).toBeUndefined();
  });

  it('records Jev’s small-tier pick for a Scout as the middle tier', () => {
    const route = routeMemberModel(onChat(pick(SONNET)), plainFacts, 'small');
    expect(route.autoWouldUse?.model).toBe('sonnet');
  });

  it('does not resume a Scout session on the fast tier', () => {
    const route = routeMemberModel(onChat(pick(SONNET)), plainFacts);
    const kept = keepScoutSession(route, { pick: pick(HAIKU), contextTokens: 1 });
    expect(kept.route.pick.model).toBe('sonnet');
    expect(kept.choice).toMatchObject({
      kept: false,
      reason: "the harness doesn't use the fast tier",
    });
    const sonnet = keepScoutSession(route, {
      pick: pick(SONNET, 'claude', 'low'),
      contextTokens: 1,
    });
    expect(sonnet.choice).toMatchObject({ kept: true });
  });

  it('never gives the Critic or a retry a retiring model', () => {
    const onSol = onChat(pick(codexModels[3]!, 'codex'));
    const soloCodex: RouteContext = { ...onSol, candidates: [codex] };
    expect(routeCritic(soloCodex).pick.model).toBe('gpt-5.6-sol');
    const first = routeBuilder(soloCodex, plainFacts);
    expect(escalate(soloCodex, first).pick.model).toBe('gpt-5.6-sol');
    const critic = routeCritic({ ...onChat(pick(SONNET)), candidates: [claude, codex] }).pick;
    expect(critic).toMatchObject({ provider: 'codex', model: 'gpt-6-sol' });
  });
});

describe('Jev’s route picks', () => {
  const call = (choice: string): JevCall => ({
    status: 'answered',
    asked: null,
    response: {
      answers: {
        route: { type: 'choice', choice, confidence: 0.97, probabilities: { [choice]: 0.97 } },
      },
    } as unknown as NonNullable<JevCall['response']>,
    error: null,
    latencyMs: 90,
    usage: null,
    model: 'jev',
  });

  it('records a retiring pick and maps what would run to the middle tier', () => {
    const route = onChat(pick(SONNET));
    const policy = routePolicy(route, plainFacts, true);
    const variant = routeVariant(call('codex/gpt-5.5'), policy, route);
    expect(variant.pick.model).toBe('gpt-5.5');
    expect(variant.raisedTo?.model).toBe('gpt-6-sol');
    const label = toLabel({
      created_at: TODAY,
      jev_text: variant,
      jev_cost_usd: 0,
    } as unknown as RoutingLabelRow);
    expect(label.jevText).toMatchObject({ pick: 'GPT-5.5', runs: '6 Sol' });
  });
});
