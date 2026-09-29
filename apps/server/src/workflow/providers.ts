import { createAcpProvider } from '../agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../agents/acp/agents.ts';
import { ZAI_MODELS } from '../agents/acp/zai.ts';
import { FAKE_PROVIDER_NAME, createFakeProvider } from '../providers/fake.ts';
import type { Provider } from '../providers/provider.ts';
import { childEnvironment } from '../setup/environment.ts';
import type { SecretStore } from '../setup/secrets.ts';

export type AgentRuntime = 'acp' | 'fake';

const FAKE_ACP_TRIGGER = '#build';

type Secrets = Pick<SecretStore, 'get'>;

const FAKE_AGENT_MODELS: Partial<Record<AgentDefinition['id'], [string, string][]>> = {
  zai: ZAI_MODELS.map((model) => [model.slot, model.label]),
};

function fakeKeyEnvironment(definition: AgentDefinition): Partial<AgentDefinition> {
  if (!definition.keyEnvironment) return {};
  const models = FAKE_AGENT_MODELS[definition.id];
  return {
    keyEnvironment: async () => ({
      ...childEnvironment(process.env),
      ...(models ? { FAKE_ACP_MODELS: JSON.stringify(models) } : {}),
    }),
  };
}

function fakeAcpProvider(definition: AgentDefinition, script: string, secrets?: Secrets): Provider {
  return createAcpProvider({
    definition: {
      ...definition,
      conversationMode: 'read-only',
      askMode: 'read-only',
      doMode: 'ask-every-action',
      ...fakeKeyEnvironment(definition),
    },
    launch: { command: process.execPath, args: ['--import', import.meta.resolve('tsx'), script] },
    cancelGraceMs: 2_000,
    ...(secrets ? { secrets } : {}),
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
  secrets?: Secrets,
): Map<string, Provider> {
  const fake = createFakeProvider();
  const providers = new Map<string, Provider>([[FAKE_PROVIDER_NAME, fake]]);
  for (const definition of Object.values(agentDefinitions)) {
    if (runtime === 'acp') {
      providers.set(
        definition.id,
        createAcpProvider({ definition, ...(secrets ? { secrets } : {}) }),
      );
    } else if (!fakeAcpAgent) {
      providers.set(definition.id, fake);
    } else {
      const acp = fakeAcpProvider(definition, fakeAcpAgent, secrets);
      providers.set(definition.id, crewFake(fake, acp));
    }
  }
  return providers;
}
