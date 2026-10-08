import { describe, expect, it } from 'vitest';
import type { PathPolicy } from '../../projects/path-policy.ts';
import { agentDefinitions } from './agents.ts';
import { sessionMeta } from './session-start.ts';

const project = { roots: [{ path: '/work/app', ignore: [] }] } as unknown as PathPolicy;

type Options = Record<string, unknown> & { tools: string[] };

function optionsOf(meta: Record<string, unknown> | null): Options {
  return (meta as { claudeCode: { options: Options } }).claudeCode.options;
}

describe('thinking text in a Claude session', () => {
  it('is asked for as summaries in a chat, a question and a changing run, without setting how much Claude thinks', () => {
    const { claude } = agentDefinitions;
    for (const options of [
      optionsOf(sessionMeta(claude, null, false, null, {})),
      optionsOf(sessionMeta(claude, project, false, null, {})),
      optionsOf(sessionMeta(claude, project, true, null, { builder: true })),
    ]) {
      expect(options.extraArgs).toEqual({ 'thinking-display': 'summarized' });
      expect(options).not.toHaveProperty('thinking');
    }
  });

  it('keeps the tools and settings the definition chose', () => {
    const { claude } = agentDefinitions;
    const shown = optionsOf(sessionMeta(claude, project, true, null, { builder: true }));
    expect(shown).toEqual({
      ...optionsOf(claude.doSessionMeta?.([], null, true) ?? null),
      extraArgs: { 'thinking-display': 'summarized' },
    });
  });

  it('is left to the agent for Z.ai, whose endpoint is not Anthropic', () => {
    const options = optionsOf(sessionMeta(agentDefinitions.zai, project, false, null, {}));
    expect(options).not.toHaveProperty('extraArgs');
  });

  it('adds nothing for an agent with no session options', () => {
    expect(sessionMeta(agentDefinitions.codex, project, false, null, {})).toBeNull();
  });
});
