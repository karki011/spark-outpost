import { describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import type { AgentSettings, ProviderOutput } from '../src/providers/provider.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const definition: AgentDefinition = {
  ...agentDefinitions.codex,
  name: 'Fake',
  ...FAKE_AGENT_MODES,
};
const provider = createAcpProvider({ definition, launch, cancelGraceMs: 2_000 });
const settings: AgentSettings = { method: 'cli', model: null, modelLabel: null, effort: null };

async function collect(prompt: string) {
  const outputs: ProviderOutput[] = [];
  for await (const output of provider.run({
    prompt,
    history: [],
    settings,
    signal: new AbortController().signal,
  })) {
    outputs.push(output);
  }
  return outputs;
}

describe('ACP provider with an agent that reports its sub-agents', { timeout: 20_000 }, () => {
  it('records each sub-agent, attributes its tool calls and keeps its words out of the reply', async () => {
    const outputs = await collect('#subagents');
    expect(replyText(outputs)).toBe('Launching. All done');
    const lifecycle = outputs.filter((output) => output.kind.startsWith('subagent_'));
    expect(lifecycle).toEqual([
      {
        kind: 'subagent_started',
        id: 'sub-1',
        parentId: null,
        name: 'Explore',
        task: 'Find the routes',
      },
      {
        kind: 'subagent_started',
        id: 'sub-2',
        parentId: null,
        name: 'Tests',
        task: 'Run the tests',
      },
      {
        kind: 'subagent_started',
        id: 'sub-3',
        parentId: 'sub-1',
        name: 'Nested',
        task: 'Look deeper',
      },
      { kind: 'subagent_finished', id: 'sub-3', state: 'done' },
      { kind: 'subagent_finished', id: 'sub-1', state: 'done' },
      { kind: 'subagent_finished', id: 'sub-2', state: 'failed' },
    ]);
    const steps = outputs.flatMap((output) =>
      output.kind === 'step_started' && output.tool
        ? [`${output.subagent ?? 'main'}: ${output.name}`]
        : [],
    );
    expect(steps).toEqual([
      'sub-1: Starting a subagent',
      'sub-2: Starting a subagent',
      'sub-1: Read routes.ts',
      'sub-3: Read deep.ts',
      'sub-2: Read tests.ts',
    ]);
    const closed = outputs.flatMap((output) =>
      output.kind === 'step_finished' && output.subagent ? [output.subagent] : [],
    );
    expect(closed).toEqual(['sub-1', 'sub-2', 'sub-3', 'sub-1', 'sub-2']);
    const calls = outputs.flatMap((output) =>
      output.kind === 'tool_started' ? [[output.id, output.subagent]] : [],
    );
    expect(calls).toEqual([
      ['c1', 'sub-1'],
      ['c3', 'sub-3'],
      ['c2', 'sub-2'],
    ]);
  });
});
