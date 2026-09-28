import { ProviderError } from '../../providers/provider.ts';
import { childEnvironment } from '../../setup/environment.ts';
import type { SecretStore } from '../../setup/secrets.ts';
import type { AgentDefinition } from './agents.ts';
import { codexUserMcpNames, disabledCodexServers } from './codex-mcp.ts';
import type { CodexRepoOptions } from './repo-session.ts';

function withHiddenServers(env: Record<string, string>, names: readonly string[]) {
  if (names.length === 0) return env;
  const config = JSON.parse(env.CODEX_CONFIG ?? '{}') as Record<string, unknown>;
  return {
    ...env,
    CODEX_CONFIG: JSON.stringify({ ...config, mcp_servers: disabledCodexServers(names) }),
  };
}

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
  const base = options.env ?? childEnvironment(process.env);
  if (definition.repoStyle !== 'codex') {
    return { ...base, ...definition.conversationEnv?.(home, browsing, repo) };
  }
  const kept = { ...base };
  delete kept.APP_SERVER_LOGS;
  const env = { ...kept, ...definition.conversationEnv?.(home, browsing, repo) };
  return withHiddenServers(env, await codexUserMcpNames(base));
}
