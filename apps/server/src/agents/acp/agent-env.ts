import { join } from 'node:path';
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

const HOSTING_TOKENS = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
];
export const NO_PUSH_URL = 'spark-outpost-no-push:///';

export function withoutPublishing(
  env: Record<string, string>,
  home: string,
): Record<string, string> {
  const kept = Object.fromEntries(
    Object.entries(env).filter(([name]) => !HOSTING_TOKENS.includes(name)),
  );
  const index = Number.parseInt(kept.GIT_CONFIG_COUNT ?? '0', 10) || 0;
  return {
    ...kept,
    GIT_CONFIG_COUNT: String(index + 1),
    [`GIT_CONFIG_KEY_${index}`]: `url.${NO_PUSH_URL}.pushInsteadOf`,
    [`GIT_CONFIG_VALUE_${index}`]: '',
    GH_CONFIG_DIR: join(home, '.spark-outpost-no-gh'),
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
  return {
    ...(options.env ?? childEnvironment(process.env)),
    ...definition.conversationEnv?.(home, browsing, repo),
  };
}

export async function agentEnvironment(
  options: AgentEnvironmentOptions,
  home: string,
  browsing = false,
  repo: CodexRepoOptions | null = null,
  builder = false,
): Promise<Record<string, string>> {
  const env = await baseEnvironment(options, home, browsing, repo);
  return builder ? withoutPublishing(env, home) : env;
}
