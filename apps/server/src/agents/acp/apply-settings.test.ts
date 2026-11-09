import * as acp from '@agentclientprotocol/sdk/unstable';
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
    expect(applied.capabilities).toMatchObject({
      models: [
        { id: 'fast-1', label: 'Fast One', description: 'Quick' },
        { id: 'smart-2', label: 'Smart Two', description: null },
      ],
      efforts: [],
      defaultModel: 'fast-1',
      defaultMode: 'agent',
      options: [],
    });
    expect(applied.capabilities.modes?.map((mode) => mode.id)).toEqual(['read-only', 'agent']);
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

  it('uses the fallback mode, with a note, when the agent lacks the chosen one', async () => {
    const { ctx, session, calls } = fakeAgent({
      configOptions: [select('mode', 'mode', 'agent', ['read-only', 'agent'])],
    });
    const applied = await applySessionSettings(ctx, session, definition, settings, {
      wanted: 'bypassPermissions',
      fallback: 'read-only',
    });
    expect(calls).toEqual([
      {
        method: 'session/set_config_option',
        params: { sessionId: 's', configId: 'mode', value: 'read-only' },
      },
    ]);
    expect(applied.notes[0]).toBe("Fake doesn't offer bypassPermissions here; using READ-ONLY");
  });

  it('sets boolean and select options by id, and skips ones the agent no longer offers', async () => {
    const { ctx, session, calls } = fakeAgent({
      configOptions: [
        select('mode', 'mode', 'read-only', ['read-only']),
        {
          id: 'fast',
          name: 'Fast',
          category: 'model_config',
          type: 'boolean',
          currentValue: false,
        },
      ],
    });
    const applied = await applySessionSettings(ctx, session, definition, {
      ...settings,
      options: { fast: true, gone: 'x' },
    });
    expect(calls).toEqual([
      {
        method: 'session/set_config_option',
        params: { sessionId: 's', configId: 'fast', type: 'boolean', value: true },
      },
    ]);
    expect(applied.notes).toContain('Fake no longer offers the gone setting you chose; skipped it');
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

function planAgent(options: acp.SessionConfigOption[]) {
  let current = options;
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const ctx = {
    request: (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      current = current.map((option) =>
        option.id === params.configId && option.type === 'select'
          ? { ...option, currentValue: String(params.value) }
          : option,
      );
      return Promise.resolve({ configOptions: current });
    },
  } as unknown as Pick<acp.ClientContext, 'request'>;
  const session = {
    sessionId: 's',
    newSessionResponse: { sessionId: 's', configOptions: options } as acp.NewSessionResponse,
  };
  return { ctx, session, calls };
}

const collaboration = (value: string) =>
  select('collaboration_mode', 'collaboration_mode', value, ['default', 'plan']);

describe('entering the native plan mode (B5)', () => {
  const claude = { ...agentDefinitions.claude, name: 'Claude' };

  it('switches Claude to its plan mode after the Ask mode', async () => {
    const { ctx, session, calls } = planAgent([
      select('mode', 'mode', 'acceptEdits', ['default', 'acceptEdits', 'plan']),
    ]);
    const applied = await applySessionSettings(ctx, session, claude, settings, {
      wanted: 'default',
      plan: true,
    });
    expect(calls.map((call) => call.params.value)).toEqual(['default', 'plan']);
    expect(applied.mode).toBe('plan');
    expect(applied.notes).toEqual([]);
  });

  it("turns on Codex's Plan collaboration mode, and turns it off again for a later turn", async () => {
    const planned = planAgent([
      select('mode', 'mode', 'read-only', ['read-only', 'agent']),
      collaboration('default'),
    ]);
    await applySessionSettings(planned.ctx, planned.session, definition, settings, {
      wanted: 'read-only',
      plan: true,
    });
    expect(planned.calls.map((call) => call.params)).toEqual([
      { sessionId: 's', configId: 'collaboration_mode', value: 'plan' },
    ]);
    const later = planAgent([
      select('mode', 'mode', 'read-only', ['read-only', 'agent']),
      collaboration('plan'),
    ]);
    await applySessionSettings(later.ctx, later.session, definition, settings, {
      wanted: 'read-only',
    });
    expect(later.calls.map((call) => call.params)).toEqual([
      { sessionId: 's', configId: 'collaboration_mode', value: 'default' },
    ]);
  });

  it('says so when the agent has no plan mode', async () => {
    const { ctx, session } = planAgent([select('mode', 'mode', 'read-only', ['read-only'])]);
    const applied = await applySessionSettings(ctx, session, definition, settings, {
      wanted: 'read-only',
      plan: true,
    });
    expect(applied.notes).toEqual(['Fake has no plan mode here; it plans in its read-only mode']);
  });
});
