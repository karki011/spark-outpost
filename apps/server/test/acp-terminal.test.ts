import { describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import type { AgentSettings, ProviderOutput } from '../src/providers/provider.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const settings: AgentSettings = { method: 'cli', model: null, modelLabel: null, effort: null };

function fake(base: AgentDefinition): AgentDefinition {
  return { ...base, name: 'Fake', ...FAKE_AGENT_MODES };
}

async function collect(definition: AgentDefinition, prompt: string) {
  const provider = createAcpProvider({ definition, launch, cancelGraceMs: 2_000 });
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

const commandOutputs = (outputs: ProviderOutput[]) =>
  outputs.filter((output) => output.kind.startsWith('command_'));

describe('command output over ACP against a fake agent', { timeout: 20_000 }, () => {
  it('does not advertise the client terminal capability or terminal output extensions', async () => {
    const outputs = await collect(fake(agentDefinitions.codex), '#caps');
    const capabilities = JSON.parse(replyText(outputs).split('\n')[0]!) as {
      terminal: boolean;
      _meta: Record<string, unknown>;
    };
    expect(capabilities.terminal).toBe(false);
    expect(capabilities._meta).not.toHaveProperty('terminal_output');
    expect(capabilities._meta).not.toHaveProperty('terminal_output_delta');
  });

  it('turns streamed terminal output deltas into live command output', async () => {
    const outputs = commandOutputs(await collect(fake(agentDefinitions.codex), '#term=pass,fail'));
    expect(outputs).toEqual([
      expect.objectContaining({ kind: 'command_started', command: 'pnpm test', live: true }),
      { kind: 'command_output', id: 'term-0', data: 'RUN v5\n' },
      { kind: 'command_output', id: 'term-0', data: '\u001b[32m✓\u001b[0m one.test.ts\n' },
      { kind: 'command_output', id: 'term-0', data: 'Tests 1 passed\n' },
      { kind: 'command_finished', id: 'term-0', failed: false, exitCode: 0 },
      expect.objectContaining({ kind: 'command_started', command: 'pnpm lint', live: true }),
      { kind: 'command_output', id: 'term-1', data: 'checking\n' },
      { kind: 'command_output', id: 'term-1', data: '\u001b[31merror\u001b[0m unused variable\n' },
      { kind: 'command_finished', id: 'term-1', failed: true, exitCode: 2 },
    ]);
    expect(outputs[0]).toHaveProperty('cwd', expect.stringMatching(/^\//));
  });

  it('reports end-only output once the command ends, named after its later title', async () => {
    const outputs = commandOutputs(
      await collect(fake(agentDefinitions.claude), '#term=endpass,endfail'),
    );
    expect(outputs).toEqual([
      { kind: 'command_started', id: 'term-0', command: 'pnpm test', cwd: null, live: false },
      expect.objectContaining({ kind: 'command_output', id: 'term-0' }),
      { kind: 'command_finished', id: 'term-0', failed: false, exitCode: null },
      { kind: 'command_started', id: 'term-1', command: 'pnpm lint', cwd: null, live: false },
      {
        kind: 'command_output',
        id: 'term-1',
        data: 'checking\n\u001b[31merror\u001b[0m unused variable',
      },
      { kind: 'command_finished', id: 'term-1', failed: true, exitCode: 2 },
    ]);
  });

  it('keeps the step list as it was', async () => {
    const outputs = await collect(fake(agentDefinitions.codex), '#term=pass');
    expect(outputs).toContainEqual(
      expect.objectContaining({ kind: 'step_started', name: '`pnpm test`', toolKind: 'execute' }),
    );
    expect(outputs).toContainEqual(
      expect.objectContaining({ kind: 'step_finished', name: '`pnpm test`', toolKind: 'execute' }),
    );
  });
});
