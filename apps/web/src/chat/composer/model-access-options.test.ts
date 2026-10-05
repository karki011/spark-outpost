import { describe, expect, it } from 'vitest';
import type { ModelOption, ProviderAccess, ProviderCapabilities } from '@spark-outpost/contracts';
import { defaultIssue, modelChoices } from '../../providers/ProviderDefaults.tsx';
import { modelCountText } from '../../providers/ModelAccessDetails.tsx';
import { availabilityTag, unusableChoice, visibleModels } from './model-options.ts';

const NOW = new Date('2026-10-05T00:00:00Z');
const SOL = { id: 'gpt-6-sol', label: '6 Sol' };
const models: ModelOption[] = [
  { id: 'gpt-6-luna', label: '6 Luna', description: null, availability: 'usable' },
  {
    id: 'gpt-6.1-sol',
    label: 'GPT-6.1 Sol',
    description: null,
    availability: 'unusable',
    switchTo: SOL,
  },
  { ...SOL, description: null, availability: 'usable' },
  { id: 'gpt-7-preview', label: 'GPT-7 Preview', description: null, availability: 'unknown' },
];
const access: ProviderAccess = {
  account: { kind: 'account', label: 'ChatGPT Plus', plan: 'plus' },
  signIn: 'ChatGPT sign-in',
  reported: true,
  usable: 2,
  unknown: 1,
  unusable: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' }],
  checkedAt: '2026-10-05T00:00:00.000Z',
  defaultIssue: null,
};
const capabilities: ProviderCapabilities = {
  provider: 'codex',
  models,
  efforts: [],
  defaultModel: 'gpt-6-sol',
  modes: [],
  defaultMode: null,
  options: [],
  capturedAt: '2026-10-05T00:00:00.000Z',
  access,
};
const ids = (list: readonly ModelOption[]) => list.map((model) => model.id);

describe('the model picker for a connection', () => {
  it('leaves out a model the sign-in cannot use, unless the chat is pinned to it', () => {
    expect(ids(visibleModels(models, 'gpt-6-sol', false, NOW))).toEqual([
      'gpt-6-luna',
      'gpt-6-sol',
      'gpt-7-preview',
    ]);
    expect(ids(visibleModels(models, 'gpt-6.1-sol', true, NOW))).toContain('gpt-6.1-sol');
  });

  it('tags an unusable pin and a model the provider did not confirm', () => {
    expect(availabilityTag(models[1]!, capabilities)).toBe('Unavailable');
    expect(availabilityTag(models[3]!, capabilities)).toBe('Unconfirmed');
    expect(availabilityTag(models[0]!, capabilities)).toBeNull();
    const unreported = { access: { ...access, reported: false } };
    expect(availabilityTag(models[3]!, unreported)).toBeNull();
    expect(availabilityTag({}, undefined)).toBeNull();
  });

  it('offers a one-click switch for an unusable pin and nothing for a usable one', () => {
    expect(unusableChoice('gpt-6.1-sol', capabilities)).toEqual({
      text: "Your ChatGPT sign-in can't use GPT-6.1 Sol.",
      switchTo: SOL,
    });
    expect(unusableChoice('gpt-6-sol', capabilities)).toBeNull();
    expect(unusableChoice(null, capabilities)).toBeNull();
    expect(unusableChoice('gpt-6.1-sol', undefined)).toBeNull();
  });
});

describe('provider defaults and the connection card', () => {
  const connection = {
    method: 'cli' as const,
    detail: 'codex 1.0',
    summary: null,
    lastTest: null,
    models: [],
    model: 'gpt-6.1-sol',
    permission: 'ask',
    agentMode: null,
    effort: null,
    verifiedAt: '2026-10-05T00:00:00.000Z',
  };

  it('disables an unusable model with the reason, also for teammate defaults', () => {
    const choices = modelChoices(connection, capabilities);
    expect(choices.find((choice) => choice.id === 'gpt-6.1-sol')?.unavailableReason).toBe(
      'Not available with your ChatGPT sign-in',
    );
    expect(choices.find((choice) => choice.id === 'gpt-6-sol')?.unavailableReason).toBeNull();
  });

  it('flags the default the backend reports as unusable, with its suggestion', () => {
    expect(defaultIssue(capabilities)).toBeNull();
    const flagged = {
      ...capabilities,
      access: {
        ...access,
        defaultIssue: { model: { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' }, suggestion: SOL },
      },
    };
    expect(defaultIssue(flagged)).toEqual({
      text: "Your ChatGPT sign-in can't use GPT-6.1 Sol.",
      switchTo: SOL,
    });
  });

  it('counts usable, unconfirmed and unavailable models', () => {
    expect(modelCountText(access)).toBe('2 usable, 1 not confirmed, 1 unavailable (GPT-6.1 Sol)');
    expect(
      modelCountText({ ...access, reported: false, usable: 0, unknown: 2, unusable: [] }),
    ).toBe('2 not confirmed');
    expect(modelCountText({ ...access, reported: false, unknown: 0, unusable: [] })).toBe(
      'None reported',
    );
  });
});
