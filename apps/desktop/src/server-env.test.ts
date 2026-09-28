import { describe, expect, it } from 'vitest';
import { channelConfig, channelPaths } from './channel.ts';
import { apiEnv, workerEnv, type ServerLaunch } from './server-env.ts';

const config = channelConfig('dev');
const paths = channelPaths('/Users/me/Library/Application Support', config);

const launch: ServerLaunch = {
  config,
  paths,
  databaseUrl: 'postgres://spark:pw@127.0.0.1:50001/spark_outpost',
  apiPort: 50002,
  apiOrigin: 'http://127.0.0.1:50002',
  token: 'a'.repeat(43),
  webRoot: '/repo/apps/web/dist',
  baseEnv: {
    PATH: '/usr/bin',
    HOME: '/Users/me',
    DATABASE_URL: 'postgres://spark@127.0.0.1:5432/spark_outpost',
    SPARK_API_TOKEN: 'inherited',
    SECRET_STORE: 'memory',
  },
};

describe('server environment', () => {
  it('points both processes at the channel database, keychain, branches and backups', () => {
    for (const env of [apiEnv(launch), workerEnv(launch)]) {
      expect(env).toMatchObject({
        PATH: '/usr/bin',
        DATABASE_URL: launch.databaseUrl,
        KEYCHAIN_SERVICE: 'Spark Outpost Dev',
        BRANCH_PREFIX: 'spark-dev',
        BACKUP_DIR: `${paths.userData}/backups`,
      });
      expect(env.SECRET_STORE).toBeUndefined();
    }
  });

  it('gives the launch token to the API only', () => {
    expect(apiEnv(launch)).toMatchObject({
      SPARK_API_TOKEN: launch.token,
      API_PORT: '50002',
      ALLOWED_ORIGINS: 'http://127.0.0.1:50002',
      WEB_ROOT: '/repo/apps/web/dist',
    });
    expect(workerEnv(launch).SPARK_API_TOKEN).toBeUndefined();
  });
});
