import { ProviderError } from '../../providers/provider.ts';
import { childEnvironment } from '../../setup/environment.ts';
import type { SecretStore } from '../../setup/secrets.ts';
import type { AgentDefinition } from './agents.ts';
import { codexUserMcpNames, disabledCodexServers } from './codex-mcp.ts';
import type { SparkFloor } from '../../spark-rules/floor-flags.ts';
import type { CodexRepoOptions } from './repo-session.ts';
import { withBackgroundSubagents } from './subagent-env.ts';

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
  codexProfiles?: boolean | undefined;
  floor?: SparkFloor | undefined;
}

export const NO_PUSH_URL = 'spark-outpost-no-push:///';

export function withoutPushing(env: Record<string, string>): Record<string, string> {
  const index = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10) || 0;
  return {
    ...env,
    GIT_CONFIG_COUNT: String(index + 1),
    [`GIT_CONFIG_KEY_${index}`]: `url.${NO_PUSH_URL}.pushInsteadOf`,
    [`GIT_CONFIG_VALUE_${index}`]: '',
  };
}

async function baseEnvironment(
  options: AgentEnvironmentOptions,
  home: string,
  browsing: boolean,
  repo: CodexRepoOptions | null,
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
    return {
      ...base,
      ...definition.conversationEnv?.(home, browsing, repo, options.codexProfiles, options.floor),
    };
  }
  const kept = { ...base };
  delete kept.APP_SERVER_LOGS;
  const env = {
    ...kept,
    ...definition.conversationEnv?.(home, browsing, repo, options.codexProfiles, options.floor),
  };
  return withHiddenServers(env, await codexUserMcpNames(base));
}

export async function agentEnvironment(
  options: AgentEnvironmentOptions,
  home: string,
  browsing = false,
  repo: CodexRepoOptions | null = null,
  cannotPush = false,
): Promise<Record<string, string>> {
  const base = await baseEnvironment(options, home, browsing, repo);
  const env = withBackgroundSubagents(options.definition, base);
  return cannotPush ? withoutPushing(env) : env;
}
