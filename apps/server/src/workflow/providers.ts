import { createAcpProvider } from '../agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../agents/acp/agents.ts';
import { FAKE_PROVIDER_NAME, createFakeProvider } from '../providers/fake.ts';
import type { Provider } from '../providers/provider.ts';

export type AgentRuntime = 'acp' | 'fake';

export const FAKE_ACP_TRIGGER = '#build';

function fakeAcpProvider(definition: AgentDefinition, script: string): Provider {
  return createAcpProvider({
    definition: { ...definition, conversationMode: 'read-only' },
    launch: { command: process.execPath, args: ['--import', import.meta.resolve('tsx'), script] },
    cancelGraceMs: 2_000,
  });
}

function crewFake(fake: Provider, acp: Provider): Provider {
  return {
    name: acp.name,
    run: (turn) => (turn.prompt.includes(FAKE_ACP_TRIGGER) ? acp : fake).run(turn),
  };
}

export function createProviders(
  runtime: AgentRuntime,
  fakeAcpAgent?: string,
): Map<string, Provider> {
  const fake = createFakeProvider();
  const providers = new Map<string, Provider>([[FAKE_PROVIDER_NAME, fake]]);
  for (const definition of Object.values(agentDefinitions)) {
    if (runtime === 'acp') providers.set(definition.id, createAcpProvider({ definition }));
    else if (!fakeAcpAgent) providers.set(definition.id, fake);
    else providers.set(definition.id, crewFake(fake, fakeAcpProvider(definition, fakeAcpAgent)));
  }
  return providers;
}
