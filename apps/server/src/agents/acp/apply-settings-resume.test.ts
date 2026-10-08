import type * as acp from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import type { AgentSettings } from '../../providers/provider.ts';
import { agentDefinitions } from './agents.ts';
import { applySessionSettings } from './apply-settings.ts';

const definition = { ...agentDefinitions.claude, conversationMode: 'default' };
const sonnet: AgentSettings = {
  method: 'cli',
  model: 'sonnet',
  modelLabel: 'Sonnet 5',
  effort: 'medium',
};

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
  options: values.map((value) => ({ value, name: value })),
});

function claudeSession(reported: { model: string; effort: string }) {
  const current = { mode: 'default', ...reported };
  const options = () => [
    select('mode', 'mode', current.mode, ['default', 'plan', 'auto']),
    select('model', 'model', current.model, ['default', 'sonnet', 'opus']),
    select('effort', 'thought_level', current.effort, ['default', 'low', 'medium', 'high']),
  ];
  const sets: { configId: string; value: string }[] = [];
  const ctx = {
    request: (
      _method: string,
      params: { configId: 'mode' | 'model' | 'effort'; value: string },
    ) => {
      sets.push({ configId: params.configId, value: params.value });
      current[params.configId] = params.value;
      return Promise.resolve({ configOptions: options() });
    },
  } as unknown as Pick<acp.ClientContext, 'request'>;
  const session = {
    sessionId: 's',
    newSessionResponse: { sessionId: 's', configOptions: options() },
  };
  return { ctx, session, sets };
}

describe('the model a resumed session runs on', () => {
  it('is set again when the resumed session already reports the chosen model', async () => {
    const { ctx, session, sets } = claudeSession({ model: 'sonnet', effort: 'default' });
    const applied = await applySessionSettings(
      ctx,
      session,
      definition,
      sonnet,
      { wanted: 'default' },
      true,
    );
    expect(sets).toEqual([
      { configId: 'model', value: 'sonnet' },
      { configId: 'effort', value: 'medium' },
    ]);
    expect(applied.current.model).toBe('sonnet');
  });

  it('is not set again on a new session that reports the chosen model', async () => {
    const { ctx, session, sets } = claudeSession({ model: 'sonnet', effort: 'medium' });
    await applySessionSettings(ctx, session, definition, sonnet, { wanted: 'default' });
    expect(sets).toEqual([]);
  });

  it('is left alone on a resumed session when the chat has no model of its own', async () => {
    const { ctx, session, sets } = claudeSession({ model: 'sonnet', effort: 'medium' });
    await applySessionSettings(
      ctx,
      session,
      definition,
      { ...sonnet, model: null, modelLabel: null },
      { wanted: 'default' },
      true,
    );
    expect(sets).toEqual([]);
  });
});
