import { describe, expect, it } from 'vitest';
import { channelConfig, channelPaths } from './channel.ts';
import { apiEnv, browserWorkerEnv, workerEnv, type ServerLaunch } from './server-env.ts';

const config = channelConfig('dev');
const paths = channelPaths('/Users/me/Library/Application Support', config);

const launch: ServerLaunch = {
  config,
  paths,
  databaseUrl: 'postgres://spark:pw@127.0.0.1:50001/spark_outpost',
  apiPort: 50002,
  apiOrigin: 'http://127.0.0.1:50002',
  token: 'a'.repeat(43),
  version: '0.1.0-beta.1',
  webRoot: '/repo/apps/web/dist',
  tmuxBin: '/repo/.local/tmux/arm64/bin/tmux',
  baseEnv: {
    PATH: '/usr/bin',
    HOME: '/Users/me',
    DATABASE_URL: 'postgres://spark@127.0.0.1:5432/spark_outpost',
    SPARK_API_TOKEN: 'inherited',
    SECRET_STORE: 'memory',
    SPARK_LOG_DIR: '/tmp/elsewhere',
    SPARK_BROWSER_DATA_DIR: '/tmp/elsewhere',
  },
};

describe('server environment', () => {
  it('points both processes at the channel database, keychain and branches', () => {
    for (const env of [apiEnv(launch), workerEnv(launch)]) {
      expect(env).toMatchObject({
        PATH: '/usr/bin',
        DATABASE_URL: launch.databaseUrl,
        KEYCHAIN_SERVICE: 'Spark Outpost Dev',
        BRANCH_PREFIX: 'spark-dev',
      });
      expect(env.SECRET_STORE).toBeUndefined();
      expect(env.BACKUP_DIR).toBeUndefined();
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

  it('tells the API where the logs are, for diagnostics', () => {
    expect(apiEnv(launch)).toMatchObject({
      SPARK_APP_VERSION: '0.1.0-beta.1',
      SPARK_LOG_DIR: '/Users/me/Library/Application Support/Spark Outpost Dev/logs',
    });
    expect(workerEnv(launch).SPARK_LOG_DIR).toBeUndefined();
  });

  it("tells both processes where Spark's browser data is, so chats can't reach it", () => {
    for (const env of [apiEnv(launch), workerEnv(launch)]) {
      expect(env.SPARK_BROWSER_DATA_DIR).toBe(
        '/Users/me/Library/Application Support/Spark Outpost Dev',
      );
    }
  });
  it('gives the API, the worker and migrations the same data folder', () => {
    const userData = '/Users/me/Library/Application Support/Spark Outpost Dev';
    expect(paths.userData).toBe(userData);
    for (const env of [apiEnv(launch), workerEnv(launch), browserWorkerEnv(launch)]) {
      expect(env.SPARK_DATA_DIR).toBe(userData);
    }
  });

  it('never passes on an inherited data folder', () => {
    const inherited = { ...launch, baseEnv: { ...launch.baseEnv, SPARK_DATA_DIR: '/elsewhere' } };
    expect(workerEnv(inherited).SPARK_DATA_DIR).toBe(paths.userData);
  });
});
