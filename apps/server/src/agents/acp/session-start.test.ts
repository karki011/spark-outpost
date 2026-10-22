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
      optionsOf(sessionMeta(claude, project, true, null, { changesProject: true })),
    ]) {
      expect(options.extraArgs).toEqual({ 'thinking-display': 'summarized' });
      expect(options).not.toHaveProperty('thinking');
    }
  });

  it('keeps the tools and settings the definition chose', () => {
    const { claude } = agentDefinitions;
    const shown = optionsOf(sessionMeta(claude, project, true, null, { changesProject: true }));
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

describe('Claude file tools for each kind of turn', () => {
  const { claude } = agentDefinitions;
  const gate = { review: async () => ({ outcome: 'cancelled' as const, note: '' }) };
  const toolsOf = (...args: Parameters<typeof sessionMeta>) =>
    optionsOf(sessionMeta(...args)).tools;
  const CHANGES = ['Read', 'Edit', 'Write', 'Bash'];

  it('gives every turn that may change files Read, Edit, Write and Bash', () => {
    for (const turn of [
      { changesProject: true, approvals: gate },
      { changesProject: false, approvals: gate },
      { changesProject: true, approvals: gate, planning: false },
    ]) {
      expect(toolsOf(claude, project, true, null, turn)).toEqual(expect.arrayContaining(CHANGES));
    }
  });

  it('gives an Ask turn reads and commands, and never Edit or Write', () => {
    const tools = toolsOf(claude, project, false, null, { approvals: gate });
    expect(tools).toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep', 'Bash']));
    expect(tools).not.toContain('Edit');
    expect(tools).not.toContain('Write');
    expect(toolsOf(claude, project, false, null, {})).not.toContain('Bash');
  });

  it('gives a Plan turn before approval only the plan file write and ExitPlanMode on top of reads', () => {
    const tools = toolsOf(claude, project, false, null, { planning: true, approvals: gate });
    expect(tools).toEqual(expect.arrayContaining(['Read', 'Write', 'ExitPlanMode']));
    expect(tools).not.toContain('Edit');
  });
});
