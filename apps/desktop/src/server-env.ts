import { API_TOKEN_ENV, BROWSER_HOST_ENV } from '@spark-outpost/contracts';
import type { ChannelConfig, ChannelPaths } from './channel.ts';

export const POSTGRES_LOCALE = 'en_US.UTF-8';

export interface ServerLaunch {
  config: ChannelConfig;
  paths: ChannelPaths;
  databaseUrl: string;
  apiPort: number;
  apiOrigin: string;
  token: string;
  version: string;
  webRoot: string;
  baseEnv: NodeJS.ProcessEnv;
}

const LAUNCHER_OWNED = [
  API_TOKEN_ENV,
  'DATABASE_URL',
  'TEST_DATABASE_URL',
  'API_HOST',
  'API_PORT',
  'ALLOWED_ORIGINS',
  'SECRET_STORE',
  'MEMORY_SECRETS',
  'AGENT_RUNTIME',
  'FAKE_ACP_AGENT',
  'KEYCHAIN_SERVICE',
  'BRANCH_PREFIX',
  'SPARK_LINK_SCHEME',
  'BACKUP_DIR',
  'WEB_ROOT',
  'NODE_OPTIONS',
  'SPARK_APP_VERSION',
  'SPARK_LOG_DIR',
  'SPARK_DATA_DIR',
  BROWSER_HOST_ENV,
];

function inherited(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  for (const name of LAUNCHER_OWNED) delete env[name];
  return env;
}

export function browserWorkerEnv(launch: ServerLaunch): NodeJS.ProcessEnv {
  return { ...workerEnv(launch), [BROWSER_HOST_ENV]: '1' };
}

export function workerEnv(launch: ServerLaunch): NodeJS.ProcessEnv {
  return {
    ...inherited(launch.baseEnv),
    LC_ALL: POSTGRES_LOCALE,
    DATABASE_URL: launch.databaseUrl,
    KEYCHAIN_SERVICE: launch.config.keychainService,
    BRANCH_PREFIX: launch.config.branchPrefix,
  };
}

export function apiEnv(launch: ServerLaunch): NodeJS.ProcessEnv {
  return {
    ...workerEnv(launch),
    API_PORT: String(launch.apiPort),
    SPARK_LINK_SCHEME: launch.config.linkScheme,
    ALLOWED_ORIGINS: launch.apiOrigin,
    WEB_ROOT: launch.webRoot,
    SPARK_APP_VERSION: launch.version,
    SPARK_LOG_DIR: launch.paths.logs,
    SPARK_DATA_DIR: launch.paths.userData,
    [API_TOKEN_ENV]: launch.token,
  };
}
