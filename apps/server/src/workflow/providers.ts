import { createAcpProvider } from '../agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../agents/acp/agents.ts';
import { ZAI_MODELS } from '../agents/acp/zai.ts';
import { FAKE_PROVIDER_NAME, createFakeProvider } from '../providers/fake.ts';
import type { Provider } from '../providers/provider.ts';
import { childEnvironment } from '../setup/environment.ts';
import type { SecretStore } from '../setup/secrets.ts';
import type { AgentRuntime, SparkToolsAccess } from '../agents/acp/spark-tools.ts';
import { cliSignedIn, type CliLocator } from '../agents/acp/agent-cli.ts';

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

function fakeAcpProvider(
  definition: AgentDefinition,
  script: string,
  secrets?: Secrets,
  sparkTools?: SparkToolsAccess,
): Provider {
  return createAcpProvider({
    definition: {
      ...definition,
      ...fakeKeyEnvironment(definition),
    },
    launch: { command: process.execPath, args: ['--import', import.meta.resolve('tsx'), script] },
    env: { ...childEnvironment(process.env), FAKE_ACP_PROVIDER: definition.id },
    cancelGraceMs: 2_000,
    ...(secrets ? { secrets } : {}),
    ...(sparkTools ? { sparkTools } : {}),
  });
}

function crewFake(fake: Provider, acp: Provider): Provider {
  return {
    name: acp.name,
    run: (turn) => (turn.prompt.includes(FAKE_ACP_TRIGGER) ? acp : fake).run(turn),
    ...(acp.sessions ? { sessions: acp.sessions } : {}),
  };
}

export function createProviders(
  runtime: AgentRuntime,
  fakeAcpAgent?: string,
  secrets?: Secrets,
  sparkTools?: SparkToolsAccess,
  locateCli?: CliLocator,
): Map<string, Provider> {
  const fake = createFakeProvider();
  const providers = new Map<string, Provider>([[FAKE_PROVIDER_NAME, fake]]);
  for (const definition of Object.values(agentDefinitions)) {
    if (runtime === 'acp') {
      providers.set(
        definition.id,
        createAcpProvider({
          definition,
          signedIn: () => cliSignedIn(definition.cli, locateCli),
          ...(locateCli ? { locateCli } : {}),
          ...(secrets ? { secrets } : {}),
          ...(sparkTools ? { sparkTools } : {}),
        }),
      );
    } else if (!fakeAcpAgent) {
      providers.set(definition.id, fake);
    } else {
      const acp = fakeAcpProvider(definition, fakeAcpAgent, secrets, sparkTools);
      providers.set(definition.id, crewFake(fake, acp));
    }
  }
  return providers;
}
