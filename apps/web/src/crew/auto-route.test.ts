import { describe, expect, it } from 'vitest';
import {
  autoThisTurn,
  autoWouldHaveUsed,
  builderRouteNote,
  chatModelName,
  modelFamily,
} from './auto-route.ts';
import { member, orchestration } from './test-orchestration.ts';

describe('Auto routing labels', () => {
  it('shortens a model to its family', () => {
    expect(modelFamily({ model: 'sonnet-5', modelLabel: 'Sonnet 5 (1M context)' })).toBe('Sonnet');
    expect(modelFamily({ model: 'gpt-5-codex', modelLabel: null })).toBe('gpt');
    expect(modelFamily({ model: 'gpt-6-sol', modelLabel: '6 Sol' })).toBe('Sol');
  });

  it('names the model Auto chose for the working agent', () => {
    const crew = [
      member({ modelLabel: 'Haiku 4.5', role: 'scout' }),
      member({ status: 'running', modelLabel: 'Sonnet 5' }),
    ];
    expect(autoThisTurn(orchestration({ crew }))).toBe('Sonnet');
    expect(autoThisTurn(orchestration({ crew, routing: 'pinned' }))).toBeNull();
  });

  it('names the model that did the work, not the Critic on another agent', () => {
    const crew = [
      member({ provider: 'codex', model: 'gpt-6-sol', modelLabel: 'GPT-6 Sol' }),
      member({ role: 'critic', provider: 'claude', modelLabel: 'Sonnet 5' }),
    ];
    const codex = orchestration({ provider: 'codex', crew });
    expect(autoThisTurn(codex)).toBe('GPT');
    const reviewing = [crew[0]!, member({ ...crew[1]!, status: 'running' })];
    expect(autoThisTurn(orchestration({ provider: 'codex', crew: reviewing }))).toBe('GPT');
    const sameAgent = [member({ modelLabel: 'Opus 5.5' }), member({ role: 'critic' })];
    expect(autoThisTurn(orchestration({ crew: sameAgent }))).toBe('Opus');
  });

  it('falls back to the model card label when a member carries none', () => {
    const cards = [{ id: 'gpt-6-sol', label: '6 Sol' }];
    const crew = [member({ provider: 'codex', model: 'gpt-6-sol', modelLabel: null })];
    const ran = orchestration({ provider: 'codex', crew });
    expect(autoThisTurn(ran, cards)).toBe('Sol');
    expect(chatModelName('auto', null, [ran], cards)).toBe('6 Sol');
    expect(autoThisTurn(ran)).toBe('gpt');
    expect(chatModelName('auto', null, [ran])).toBe('gpt-6-sol');
  });

  it('names the model an Auto chat ran on, not the one stored for a pinned chat', () => {
    const opus = { model: 'opus', modelLabel: 'Opus 5.5 (1M context)' };
    const ran = orchestration({
      crew: [member(opus), member({ role: 'critic', modelLabel: 'Sonnet 5' })],
    });
    const starting = orchestration({ crew: [member({ startedAt: null, status: 'queued' })] });
    expect(chatModelName('auto', 'Sonnet 5', [ran])).toBe('Opus 5.5');
    expect(chatModelName('auto', 'Sonnet 5', [ran, starting])).toBe('Opus 5.5');
    expect(chatModelName('auto', 'Sonnet 5', [])).toBe('Auto');
    expect(chatModelName('auto', 'Sonnet 5', [{ ...ran, routing: 'pinned' }])).toBe('Auto');
    expect(chatModelName('pinned', 'Sonnet 5', [ran])).toBe('Sonnet 5');
    expect(chatModelName(undefined, null, [ran])).toBeNull();
  });

  it('hints what Auto would have used with a pinned model', () => {
    const pick = { provider: 'claude', model: 'haiku-4.5', modelLabel: 'Haiku 4.5', effort: 'low' };
    const crew = [member({ autoWouldUse: pick })];
    expect(autoWouldHaveUsed(orchestration({ routing: 'pinned', crew }))).toBe('Haiku');
    const same = [member({ autoWouldUse: { ...pick, modelLabel: 'Sonnet 5' } })];
    expect(autoWouldHaveUsed(orchestration({ routing: 'pinned', crew: same }))).toBeNull();
  });

  it('says when the Builder was raised off the fast tier', () => {
    const note = "raised to Sonnet 5: Builders don't run on the fast tier";
    const crew = [member({ role: 'scout' }), member({ routeNote: note })];
    expect(builderRouteNote(orchestration({ crew }))).toBe(
      "Raised to Sonnet 5: Builders don't run on the fast tier",
    );
    expect(builderRouteNote(orchestration({ crew: [member()] }))).toBeNull();
    expect(builderRouteNote(null)).toBeNull();
  });
});
