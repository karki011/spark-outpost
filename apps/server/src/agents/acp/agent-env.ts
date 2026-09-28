import { ProviderError } from '../../providers/provider.ts';
import { childEnvironment } from '../../setup/environment.ts';
import type { SecretStore } from '../../setup/secrets.ts';
import type { AgentDefinition } from './agents.ts';
import type { CodexRepoOptions } from './repo-session.ts';

export interface AgentEnvironmentOptions {
  definition: AgentDefinition;
  env?: Record<string, string> | undefined;
  secrets?: Pick<SecretStore, 'get'> | undefined;
}

export async function agentEnvironment(
  options: AgentEnvironmentOptions,
  home: string,
  browsing = false,
  repo: CodexRepoOptions | null = null,
): Promise<Record<string, string>> {
  const { definition } = options;
  if (definition.keyEnvironment) {
    const key = await options.secrets?.get(definition.id).catch(() => null);
    if (!key) {
      throw new ProviderError(
        `${definition.name} has no stored API key. Paste the key again in Settings.`,
      );
    }
    return definition.keyEnvironment(key);
  }
  return {
    ...(options.env ?? childEnvironment(process.env)),
    ...definition.conversationEnv?.(home, browsing, repo),
  };
}
