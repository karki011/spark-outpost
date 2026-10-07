import type * as acp from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import type { AgentSettings } from '../../providers/provider.ts';
import { agentDefinitions } from './agents.ts';
import { applySessionSettings } from './apply-settings.ts';

const definition = { ...agentDefinitions.claude, name: 'Fake', conversationMode: 'read-only' };
const settings: AgentSettings = { method: 'cli', model: null, modelLabel: null, effort: null };

const modes = (currentValue: string): acp.SessionConfigOption => ({
  id: 'mode',
  name: 'Mode',
  category: 'mode',
  type: 'select',
  currentValue,
  options: [
    { value: 'read-only', name: 'Ask first' },
    { value: 'bypassPermissions', name: 'Bypass permissions' },
  ],
});

function resumedIn(mode: string, obeys: boolean) {
  const calls: Record<string, unknown>[] = [];
  const ctx = {
    request: (_method: string, params: Record<string, unknown>) => {
      calls.push(params);
      return Promise.resolve({ configOptions: [modes(obeys ? String(params.value) : mode)] });
    },
  } as unknown as Pick<acp.ClientContext, 'request'>;
  const session = {
    sessionId: 's',
    newSessionResponse: { sessionId: 's', configOptions: [modes(mode)] },
  };
  return { ctx, session, calls };
}

describe('the mode a resumed session runs in', () => {
  it('is set back to read-only before a question when the session last ran in a writing mode', async () => {
    const { ctx, session, calls } = resumedIn('bypassPermissions', true);
    const applied = await applySessionSettings(ctx, session, definition, settings, {
      wanted: 'read-only',
    });
    expect(calls).toEqual([{ sessionId: 's', configId: 'mode', value: 'read-only' }]);
    expect(applied.mode).toBe('read-only');
  });

  it('stops the run before the prompt when the agent reports it stayed in the writing mode', async () => {
    const { ctx, session } = resumedIn('bypassPermissions', false);
    await expect(
      applySessionSettings(ctx, session, definition, settings, { wanted: 'read-only' }),
    ).rejects.toThrow(
      'Fake stayed in Bypass permissions mode instead of Ask first, so the run was stopped before it started.',
    );
  });
});
