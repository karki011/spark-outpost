import type { NewSessionResponse, SessionConfigOption } from '@agentclientprotocol/sdk/unstable';
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
      modes: [],
      defaultMode: null,
      options: [],
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
    expect(capabilitiesFrom([])).toEqual({
      models: [],
      efforts: [],
      defaultModel: null,
      modes: [],
      defaultMode: null,
      options: [],
    });
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
      modes: [],
      defaultMode: null,
      options: [],
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

describe('modes and other options from config options', () => {
  it('reads every mode the agent advertises, with its kind, and the mode it started in', () => {
    const report = capabilitiesFrom([
      {
        id: 'mode',
        name: 'Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'default',
        options: [
          {
            value: 'default',
            name: 'Manual',
            description: 'Always ask',
            _meta: { kind: 'standard' },
          },
          { value: 'yolo', name: 'Yolo', description: 'Custom', _meta: { kind: 'full_access' } },
        ],
      },
    ]);
    expect(report.modes).toEqual([
      { id: 'default', label: 'Manual', description: 'Always ask', kind: 'standard' },
      { id: 'yolo', label: 'Yolo', description: 'Custom', kind: 'full_access' },
    ]);
    expect(report.defaultMode).toBe('default');
  });

  it('keeps model_config, unknown categories and booleans as generic options, with groups', () => {
    const report = capabilitiesFrom([
      {
        id: 'fast',
        name: 'Fast mode',
        category: 'model_config',
        type: 'boolean',
        currentValue: false,
      },
      {
        id: 'collaboration_mode',
        name: 'Collaboration',
        category: 'collaboration_mode',
        type: 'select',
        currentValue: 'default',
        options: [
          {
            group: 'g',
            name: 'Styles',
            options: [
              { value: 'default', name: 'Default' },
              { value: 'plan', name: 'Plan' },
            ],
          },
        ],
      },
    ]);
    expect(report.options).toEqual([
      {
        type: 'boolean',
        id: 'fast',
        name: 'Fast mode',
        description: null,
        category: 'model_config',
        currentValue: false,
      },
      {
        type: 'select',
        id: 'collaboration_mode',
        name: 'Collaboration',
        description: null,
        category: 'collaboration_mode',
        currentValue: 'default',
        choices: [
          { id: 'default', label: 'Default', description: null, group: 'Styles' },
          { id: 'plan', label: 'Plan', description: null, group: 'Styles' },
        ],
      },
    ]);
  });
});
