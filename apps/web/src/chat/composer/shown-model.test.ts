import { describe, expect, it } from 'vitest';
import type { ChatSettings, ProviderCapabilities, Run } from '@spark-outpost/contracts';
import { run } from '../../crew/test-run.ts';
import { unlistedPinName } from './shown-model.ts';

const option = (id: string, label: string) => ({ id, label, description: null });

const BEFORE_FIRST_SESSION = [
  option('default', 'Default (recommended)'),
  option('opus', 'Opus 5.5'),
  option('sonnet', 'Sonnet 5.5'),
];
const AFTER_FIRST_SESSION = [
  option('default', 'Default (recommended)'),
  option('claude-opus-5-5', 'Opus 5.5'),
  option('claude-sonnet-5-5', 'Sonnet 5.5'),
  option('claude-sonnet-5', 'Sonnet 5'),
];

const offering = (models: ReturnType<typeof option>[]) =>
  ({ models, defaultModel: 'claude-opus-5-5' }) as unknown as ProviderCapabilities;
const pinned = (model: string | null) => ({ provider: 'claude', model }) as ChatSettings;
const ranOn = (model: string, usedModel: string | null, extra: Partial<Run> = {}) =>
  run({ model, usedModel, ...extra });

describe('the name shown for a pinned model the agent no longer lists', () => {
  it('is left to the list while the pin is listed, and when nothing is pinned', () => {
    expect(unlistedPinName(pinned('sonnet'), offering(BEFORE_FIRST_SESSION), [])).toBeNull();
    expect(unlistedPinName(pinned(null), offering(AFTER_FIRST_SESSION), [])).toBeNull();
    expect(unlistedPinName(pinned('sonnet'), undefined, [])).toBeNull();
  });

  it('is the model the session reported running, never the default’s name', () => {
    const runs = [ranOn('sonnet', 'claude-sonnet-5-5')];
    expect(unlistedPinName(pinned('sonnet'), offering(AFTER_FIRST_SESSION), runs)).toBe(
      'Sonnet 5.5',
    );
    const opus = [ranOn('opus', 'claude-opus-5-5[1m]')];
    expect(unlistedPinName(pinned('opus'), offering(AFTER_FIRST_SESSION), opus)).toBe('Opus 5.5');
  });

  it('is the pin as typed until a turn has run with it', () => {
    expect(unlistedPinName(pinned('sonnet'), offering(AFTER_FIRST_SESSION), [])).toBe('Sonnet');
    const other = [ranOn('claude-opus-5-5', 'claude-opus-5-5')];
    expect(unlistedPinName(pinned('sonnet'), offering(AFTER_FIRST_SESSION), other)).toBe('Sonnet');
    const child = [ranOn('sonnet', 'claude-sonnet-5', { parentRunId: run().id })];
    expect(unlistedPinName(pinned('sonnet'), offering(AFTER_FIRST_SESSION), child)).toBe('Sonnet');
  });

  it('follows the latest turn that ran with the pin', () => {
    const runs = [ranOn('sonnet', 'claude-sonnet-5'), ranOn('sonnet', 'claude-sonnet-5-5')];
    expect(unlistedPinName(pinned('sonnet'), offering(AFTER_FIRST_SESSION), runs)).toBe(
      'Sonnet 5.5',
    );
  });

  it('is the model a turn fell back to when the agent could not take the pin', () => {
    const codex = {
      models: [option('gpt-6-sol', '6 Sol')],
      defaultModel: 'gpt-6-sol',
    } as unknown as ProviderCapabilities;
    const fellBack = run({
      provider: 'codex',
      model: 'gpt-6-sol',
      modelSwitch: {
        provider: 'codex',
        signIn: 'ChatGPT sign-in',
        from: { id: 'gpt-6-luna', label: 'gpt-6-luna' },
        to: { id: 'gpt-6-sol', label: '6 Sol' },
        learned: false,
      },
    });
    const settings = { provider: 'codex', model: 'gpt-6-luna' } as ChatSettings;
    expect(unlistedPinName(settings, codex, [fellBack])).toBe('6 Sol');
  });
});
