import { describe, expect, it } from 'vitest';
import { sparkRunSettings, type InheritedPlace } from './spark-settings.ts';

const chat = (extra: Partial<InheritedPlace> = {}): InheritedPlace => ({
  provider: 'claude',
  model: 'chat-model',
  effort: 'low',
  agentMode: 'bypassPermissions',
  usable: () => true,
  inChat: true,
  appliesOwnMode: true,
  ...extra,
});

const defaults = {
  provider: null,
  model: null,
  effort: null,
  agentMode: null,
  connected: false,
};

const explicit = {
  provider: 'claude',
  model: 'claude-haiku-5-5',
  effort: 'high',
  agentMode: 'default',
  connected: true,
};

describe('which agent and mode a Spark runs with', () => {
  it('takes the chat’s agent, model, effort and mode for Default agent and Default mode', () => {
    expect(sparkRunSettings(chat(), defaults)).toEqual({
      provider: 'claude',
      model: 'chat-model',
      effort: 'low',
      agentMode: 'bypassPermissions',
      agentFrom: 'chat',
      modeFrom: 'chat',
    });
  });

  it('names your default as the source when the run has no chat of its own', () => {
    const settings = sparkRunSettings(chat({ inChat: false, agentMode: 'default' }), defaults);
    expect(settings).toMatchObject({ agentMode: 'default', agentFrom: 'default' });
    expect(settings.modeFrom).toBe('default');
  });

  it('keeps the Spark’s own agent, model, effort and mode, whatever the chat uses', () => {
    expect(sparkRunSettings(chat(), explicit)).toEqual({
      provider: 'claude',
      model: 'claude-haiku-5-5',
      effort: 'high',
      agentMode: 'default',
      agentFrom: 'spark',
      modeFrom: 'spark',
    });
    expect(sparkRunSettings(chat({ inChat: false }), explicit).modeFrom).toBe('spark');
  });

  it('takes the chat’s mode, mapped to the Spark’s agent, when only the agent is the Spark’s', () => {
    const codex = { ...explicit, provider: 'codex', model: null, effort: null, agentMode: null };
    expect(sparkRunSettings(chat(), codex)).toEqual({
      provider: 'codex',
      model: null,
      effort: null,
      agentMode: 'agent-full-access',
      agentFrom: 'spark',
      modeFrom: 'chat',
    });
    expect(sparkRunSettings(chat({ agentMode: 'default' }), codex).agentMode).toBe(
      'ask-every-action',
    );
  });

  it('fills the model and effort from the chat on the chat’s own agent', () => {
    const own = { ...explicit, model: null, effort: null, agentMode: null };
    expect(sparkRunSettings(chat(), own)).toMatchObject({
      model: 'chat-model',
      effort: 'low',
      agentMode: 'bypassPermissions',
      modeFrom: 'chat',
    });
  });

  it('falls back to the chat’s agent and mode when the Spark’s agent is not connected', () => {
    const away = { ...explicit, provider: 'codex', agentMode: 'agent' };
    expect(sparkRunSettings(chat({ usable: (id) => id !== 'codex' }), away)).toEqual({
      provider: 'claude',
      model: 'chat-model',
      effort: 'low',
      agentMode: 'bypassPermissions',
      agentFrom: 'chat',
      modeFrom: 'chat',
    });
    expect(sparkRunSettings(chat(), { ...away, connected: false }).provider).toBe('claude');
  });

  it('never applies the Spark’s own mode where the caller says not to, such as a review', () => {
    expect(sparkRunSettings(chat({ appliesOwnMode: false }), explicit)).toMatchObject({
      agentMode: 'bypassPermissions',
      modeFrom: 'chat',
    });
  });
});
