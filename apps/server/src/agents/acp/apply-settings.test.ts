import * as acp from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { ProviderError, type AgentSettings } from '../../providers/provider.ts';
import { agentDefinitions } from './agents.ts';
import { applySessionSettings, applySettings } from './apply-settings.ts';

const definition = { ...agentDefinitions.codex, name: 'Fake', conversationMode: 'read-only' };
const settings: AgentSettings = { method: 'cli', model: null, modelLabel: null, effort: null };

const select = (
  id: string,
  category: string,
  currentValue: string,
  values: string[],
): acp.SessionConfigOption => ({
  id,
  name: id,
  category,
  type: 'select',
  currentValue,
  options: values.map((value) => ({ value, name: value.toUpperCase() })),
});

const legacyModes = {
  currentModeId: 'agent',
  availableModes: [
    { id: 'read-only', name: 'Read only' },
    { id: 'agent', name: 'Agent' },
  ],
};

const legacyModels = {
  currentModelId: 'fast-1',
  availableModels: [
    { modelId: 'fast-1', name: 'Fast One', description: 'Quick' },
    { modelId: 'smart-2', name: 'Smart Two' },
    { name: 'No id' },
  ],
};

function fakeAgent(response: Record<string, unknown>) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let effort = 'medium';
  const ctx = {
    request: (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === acp.methods.agent.session.setConfigOption) {
        effort = String(params.value);
        return Promise.resolve({
          configOptions: [
            select('mode', 'mode', 'read-only', ['read-only', 'agent']),
            select('effort', 'thought_level', effort, ['low', 'medium', 'high', 'max']),
          ],
        });
      }
      return Promise.resolve({});
    },
  } as unknown as Pick<acp.ClientContext, 'request'>;
  const session = {
    sessionId: 's',
    newSessionResponse: { sessionId: 's', ...response } as acp.NewSessionResponse,
  };
  return { ctx, session, calls };
}

describe('applying chat settings', () => {
  it('switches legacy modes with set_mode and reads models from the legacy shape', async () => {
    const { ctx, session, calls } = fakeAgent({ modes: legacyModes, models: legacyModels });
    const applied = await applySessionSettings(ctx, session, definition, {
      ...settings,
      model: 'smart-2',
      modelLabel: 'Smart Two',
    });
    expect(calls).toEqual([
      { method: 'session/set_mode', params: { sessionId: 's', modeId: 'read-only' } },
    ]);
    expect(applied.mode).toBe('read-only');
    expect(applied.notes).toEqual([
      "Using Fake's default model; Smart Two can't be selected with this agent",
    ]);
    expect(applied.capabilities).toEqual({
      models: [
        { id: 'fast-1', label: 'Fast One', description: 'Quick' },
        { id: 'smart-2', label: 'Smart Two', description: null },
      ],
      efforts: [],
      defaultModel: 'fast-1',
    });
  });

  it('prefers config options over legacy modes and reports the fresher options', async () => {
    const { ctx, session, calls } = fakeAgent({
      modes: legacyModes,
      configOptions: [
        select('mode', 'mode', 'read-only', ['read-only', 'agent']),
        select('effort', 'thought_level', 'medium', ['low', 'medium']),
      ],
    });
    const applied = await applySessionSettings(ctx, session, definition, {
      ...settings,
      effort: 'max',
    });
    expect(calls).toEqual([]);
    expect(applied.notes).toEqual(["Using Fake's default effort; max isn't offered by the agent"]);

    const upgraded = await applySessionSettings(ctx, session, definition, {
      ...settings,
      effort: 'low',
    });
    expect(calls.map((call) => call.method)).toEqual(['session/set_config_option']);
    expect(upgraded.capabilities.efforts.map((effort) => effort.id)).toEqual([
      'low',
      'medium',
      'high',
      'max',
    ]);
    expect(upgraded.mode).toBe('read-only');
  });

  it('stops before the turn when no safe mode is offered in either shape', async () => {
    const { ctx, session } = fakeAgent({
      modes: { currentModeId: 'agent', availableModes: [{ id: 'agent', name: 'Agent' }] },
    });
    await expect(applySettings(ctx, session, definition, settings)).rejects.toBeInstanceOf(
      ProviderError,
    );
  });
});
