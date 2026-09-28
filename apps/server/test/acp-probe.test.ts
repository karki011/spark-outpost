import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import { probeCapabilities } from '../src/agents/acp/probe.ts';
import { ProviderError } from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';

const definition: AgentDefinition = { ...agentDefinitions.codex, name: 'Fake' };
const launch = {
  command: process.execPath,
  args: [join(import.meta.dirname, 'fake-acp-agent.ts')],
};
const probe = (env: Record<string, string> = {}) =>
  probeCapabilities(definition, { launch, env: { ...childEnvironment(process.env), ...env } });

describe('capability probe against a fake agent', { timeout: 20_000 }, () => {
  it('reads models and efforts from the config options', async () => {
    const report = await probe();
    expect(report.models.map((model) => model.id)).toEqual(['fast-1', 'smart-2']);
    expect(report.efforts.map((effort) => effort.id)).toEqual(['low', 'medium', 'high']);
  });

  it('reads legacy models without sending our own option ids to the agent', async () => {
    const report = await probe({ FAKE_ACP_LEGACY: '1' });
    expect(report.models.map((model) => model.id)).toEqual(['fast-1', 'smart-2']);
    expect(report.efforts).toEqual([]);
  });

  it('refuses an agent that answers with another protocol version', async () => {
    const error = await probe({ FAKE_ACP_PROTOCOL_VERSION: '2' }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toBe('Fake speaks ACP version 2, but Spark Outpost needs 1.');
  });
});
