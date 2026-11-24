import { describe, expect, it } from 'vitest';
import { agentDefinitions } from './agents.ts';
import { withStartingModel } from './starting-model-env.ts';

const inherited = { PATH: '/usr/bin', ANTHROPIC_MODEL: 'from-the-shell' };

describe('the model a Claude agent process starts on', () => {
  it('is the chat’s chosen model, so the session opens on it without a switch', () => {
    expect(withStartingModel(agentDefinitions.claude, inherited, 'claude-sonnet-5')).toEqual({
      PATH: '/usr/bin',
      ANTHROPIC_MODEL: 'claude-sonnet-5',
    });
  });

  it('is left alone when the chat uses the default model', () => {
    expect(withStartingModel(agentDefinitions.claude, inherited, null)).toBe(inherited);
  });

  it('is left alone for other agents and endpoints, which map models themselves', () => {
    for (const definition of [agentDefinitions.codex, agentDefinitions.zai]) {
      expect(withStartingModel(definition, inherited, 'claude-sonnet-5')).toBe(inherited);
    }
  });
});
