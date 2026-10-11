import * as acp from '@agentclientprotocol/sdk';
import { resolveModelPreference } from '@agentclientprotocol/claude-agent-acp/dist/session-model.js';
import { describe, expect, it } from 'vitest';
import type { AgentSettings } from '../../providers/provider.ts';
import { agentDefinitions } from './agents.ts';
import { applySessionSettings } from './apply-settings.ts';

const OFFERED = [
  {
    value: 'default',
    displayName: 'Default (recommended)',
    description: 'Opus 5.5 with 1M context',
    resolvedModel: 'claude-opus-5-5[1m]',
  },
  { value: 'claude-sonnet-5-5', displayName: 'Sonnet', description: 'Sonnet 5.5 for daily work' },
  { value: 'claude-haiku-5-5', displayName: 'Haiku', description: 'Haiku 5.5, the fastest' },
  { value: 'claude-sonnet-5', displayName: 'Sonnet 5', description: 'The earlier Sonnet' },
];
const NAMES: Record<string, string> = {
  default: 'Default (recommended)',
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-haiku-5-5': 'Haiku 5.5',
  'claude-sonnet-5': 'Sonnet 5',
};
const settings: AgentSettings = { method: 'cli', model: null, modelLabel: null, effort: null };

function options(model: string): acp.SessionConfigOption[] {
  return [
    {
      id: 'mode',
      name: 'Mode',
      category: 'mode',
      type: 'select',
      currentValue: 'default',
      options: [{ value: 'default', name: 'Manual' }],
    },
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: model,
      options: OFFERED.map(({ value }) => ({ value, name: NAMES[value] ?? value })),
    },
  ];
}

function pinnedClaudeAgent() {
  const asked: unknown[] = [];
  let model = 'default';
  const ctx = {
    request: (method: string, params: { configId?: string; value?: string }) => {
      if (method !== acp.methods.agent.session.setConfigOption) return Promise.resolve({});
      asked.push(params.value);
      if (params.configId === 'model') {
        const wanted = params.value ?? '';
        const exact = OFFERED.find((offered) => offered.value === wanted);
        const resolved = exact ?? resolveModelPreference(OFFERED, wanted);
        if (!resolved) {
          return Promise.reject(new Error(`Invalid value for config option model: ${wanted}`));
        }
        model = resolved.value;
      }
      return Promise.resolve({ configOptions: options(model) });
    },
  } as unknown as Pick<acp.ClientContext, 'request'>;
  const session = {
    sessionId: 's',
    newSessionResponse: { sessionId: 's', configOptions: options(model) },
  };
  return { ctx, session, asked };
}

describe('a pinned model the session lists under another id', () => {
  it('runs the listed Claude model when the session offers it under its full id', async () => {
    const { ctx, session } = pinnedClaudeAgent();
    const applied = await applySessionSettings(ctx, session, agentDefinitions.claude, {
      ...settings,
      model: 'sonnet',
    });
    expect(applied.current.model).toBe('claude-sonnet-5-5');
    expect(applied.using).toBe('Using Sonnet 5.5');
    expect(applied.notes).toEqual([]);
    expect(applied.live.unpinnedModel()).toBeNull();
  });

  it.each(['claude-sonnet-5-5', 'Sonnet', 'haiku'])('runs %s as pinned', async (model) => {
    const { ctx, session } = pinnedClaudeAgent();
    const applied = await applySessionSettings(ctx, session, agentDefinitions.claude, {
      ...settings,
      model,
    });
    expect(applied.current.model).toBe(
      model === 'haiku' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5',
    );
    expect(applied.notes).toEqual([]);
  });

  it('sends an alias as typed and shows the model the agent resolved it to', async () => {
    const { ctx, session, asked } = pinnedClaudeAgent();
    const applied = await applySessionSettings(ctx, session, agentDefinitions.claude, {
      ...settings,
      model: 'sonnet',
    });
    expect(asked).toContain('sonnet');
    expect(asked).not.toContain('claude-sonnet-5');
    expect(applied.current.model).toBe('claude-sonnet-5-5');
    expect(applied.using).toBe('Using Sonnet 5.5');
  });

  it('runs the earlier generation only when its full id is pinned', async () => {
    const { ctx, session } = pinnedClaudeAgent();
    const applied = await applySessionSettings(ctx, session, agentDefinitions.claude, {
      ...settings,
      model: 'claude-sonnet-5',
    });
    expect(applied.current.model).toBe('claude-sonnet-5');
    expect(applied.using).toBe('Using Sonnet 5');
  });

  it('picks the listed model by the label the alias had when it was chosen', async () => {
    const { ctx, session, asked } = pinnedClaudeAgent();
    const applied = await applySessionSettings(ctx, session, agentDefinitions.claude, {
      ...settings,
      model: 'sonnet',
      modelLabel: 'Sonnet 5.5',
    });
    expect(asked).toEqual(['claude-sonnet-5-5']);
    expect(applied.current.model).toBe('claude-sonnet-5-5');
  });

  it('never lands on another generation of the pinned model', async () => {
    const { ctx, session } = pinnedClaudeAgent();
    const applied = await applySessionSettings(ctx, session, agentDefinitions.claude, {
      ...settings,
      model: 'claude-sonnet-4-6',
      modelLabel: 'Sonnet 4.6',
    });
    expect(applied.current.model).toBe('default');
    expect(applied.notes).toEqual([
      "Using Claude's default model; Sonnet 4.6 isn't offered by the agent",
    ]);
    expect(applied.live.unpinnedModel()).toBe('Sonnet 4.6');
  });

  it('leaves an agent that resolves no names on its default without asking it', async () => {
    const { ctx, session, asked } = pinnedClaudeAgent();
    const codex = { ...agentDefinitions.codex, conversationMode: 'default' };
    const applied = await applySessionSettings(ctx, session, codex, {
      ...settings,
      model: 'sonnet',
    });
    expect(asked).toEqual([]);
    expect(applied.current.model).toBe('default');
    expect(applied.notes).toEqual([
      "Using Codex's default model; sonnet isn't offered by the agent",
    ]);
  });
});
