import type { NewSessionResponse, SessionConfigOption } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { capabilitiesFrom, sessionCapabilities } from './capabilities.ts';

describe('capabilities from config options', () => {
  it('reads models with descriptions, efforts, and the current model', () => {
    expect(
      capabilitiesFrom([
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'default',
          options: [
            { value: 'default', name: 'Default (recommended)', description: 'Opus 5.5' },
            { value: 'haiku', name: 'Haiku 4.5' },
          ],
        },
        {
          id: 'effort',
          name: 'Effort',
          category: 'thought_level',
          type: 'select',
          currentValue: 'high',
          options: [{ value: 'high', name: 'High' }],
        },
      ]),
    ).toEqual({
      models: [
        { id: 'default', label: 'Default (recommended)', description: 'Opus 5.5' },
        { id: 'haiku', label: 'Haiku 4.5', description: null },
      ],
      efforts: [{ id: 'high', label: 'High', description: null }],
      defaultModel: 'default',
    });
  });

  it('leaves out older, deprecated, and legacy models, even the current one', () => {
    const report = capabilitiesFrom([
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'gpt-5.5',
        options: [
          { value: 'gpt-6-sol', name: '6 Sol', description: 'Workhorse model for coding.' },
          { value: 'gpt-5.6-sol', name: '5.6 Sol', description: 'Older coding model.' },
          { value: 'gpt-5.4', name: '5.4', description: 'Deprecated model.' },
          { value: 'gpt-5.5', name: '5.5', description: 'Legacy coding model.' },
        ],
      },
    ]);
    expect(report.models.map((model) => model.id)).toEqual(['gpt-6-sol']);
    expect(report.defaultModel).toBe('gpt-6-sol');
  });

  it('returns empty lists when the agent offers no options', () => {
    expect(capabilitiesFrom([])).toEqual({ models: [], efforts: [], defaultModel: null });
  });
});

describe('capabilities from a new session', () => {
  it('reads legacy models when no model config option is offered', () => {
    expect(
      sessionCapabilities({
        sessionId: 's',
        models: {
          currentModelId: 'b',
          availableModels: [
            { modelId: 'a', name: 'A' },
            { modelId: 'b', name: 'B', description: 'Best' },
            'junk',
          ],
        },
      } as NewSessionResponse),
    ).toEqual({
      models: [
        { id: 'a', label: 'A', description: null },
        { id: 'b', label: 'B', description: 'Best' },
      ],
      efforts: [],
      defaultModel: 'b',
    });
  });

  it('keeps the model config option when both shapes are present', () => {
    const report = sessionCapabilities({
      sessionId: 's',
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'x',
          options: [{ value: 'x', name: 'X' }],
        },
      ],
      models: { currentModelId: 'a', availableModels: [{ modelId: 'a', name: 'A' }] },
    } as NewSessionResponse);
    expect(report.models.map((model) => model.id)).toEqual(['x']);
  });

  it('keeps the default from the options it started with', () => {
    const model = (currentValue: string): SessionConfigOption => ({
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue,
      options: [
        { value: 'a', name: 'A' },
        { value: 'b', name: 'B' },
      ],
    });
    expect(capabilitiesFrom([model('b')], [model('a')]).defaultModel).toBe('a');
  });
});
