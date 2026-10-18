import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import type { ProviderOutput } from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { cacheTtlOf, contextOf } from '../src/usage/prompt-cache.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch } from './fake-acp-support.ts';

const definition: AgentDefinition = { ...agentDefinitions.claude, ...FAKE_AGENT_MODES };
const recorded = fileURLToPath(
  new URL('./fixtures/prompt-cache/sdk-messages.json', import.meta.url),
);

async function requestOutputs(prompt: string) {
  const provider = createAcpProvider({
    definition,
    launch,
    env: { ...childEnvironment(process.env), FAKE_ACP_SDK_MESSAGES: recorded },
    cancelGraceMs: 2_000,
  });
  const outputs: ProviderOutput[] = [];
  for await (const output of provider.run({
    prompt,
    history: [],
    settings: { method: 'cli', model: 'opus', modelLabel: 'Opus 5.5', effort: null },
    signal: new AbortController().signal,
  })) {
    outputs.push(output);
  }
  return outputs.flatMap((output) => (output.kind === 'request_usage' ? [output.request] : []));
}

describe('per-request cache numbers from recorded Claude SDK messages', { timeout: 20_000 }, () => {
  it('reads the main thread request with its cache buckets and drops sub-agent and synthetic ones', async () => {
    const requests = await requestOutputs('#requests');
    expect(requests).toEqual([
      {
        key: 'msg_011Cg8UBjn2R9Vmwgp4RXJ3G',
        model: 'claude-haiku-5-5',
        input: 2,
        output: 4,
        cachedRead: 26_499,
        cachedWrite: 12_185,
        buckets: { short: 0, long: 12_185 },
      },
    ]);
    expect(cacheTtlOf(requests[0]!.buckets)).toBe(3600);
    expect(contextOf(requests[0]!)).toBe(2 + 4 + 26_499 + 12_185);
  });

  it('carries no request text, only ids, the model and token counts', async () => {
    const requests = await requestOutputs('#requests');
    expect(JSON.stringify(requests)).not.toMatch(/"ok"|sub-agent text|hit your limit/);
  });
});
