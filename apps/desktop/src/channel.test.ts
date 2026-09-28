import { describe, expect, it } from 'vitest';
import { channelConfig, channelPaths, resolveChannel } from './channel.ts';

const APP_DATA = '/Users/me/Library/Application Support';

describe('channel', () => {
  it('runs from source as the dev channel and only a packaged build as prod', () => {
    expect(resolveChannel(false)).toBe('dev');
    expect(resolveChannel(true)).toBe('prod');
  });

  it('names every dev resource apart from the installed app', () => {
    const dev = channelConfig('dev');
    const prod = channelConfig('prod');
    expect(dev).toMatchObject({
      appName: 'Spark Outpost Dev',
      badge: 'DEV',
      keychainService: 'Spark Outpost Dev',
      linkScheme: 'spark-outpost-dev',
      branchPrefix: 'spark-dev',
      autoUpdate: false,
    });
    for (const key of [
      'appName',
      'appId',
      'dataFolderName',
      'keychainService',
      'linkScheme',
      'branchPrefix',
    ] as const) {
      expect(dev[key]).not.toBe(prod[key]);
    }
  });

  it('keeps the dev data, database and backups under the dev folder', () => {
    const paths = channelPaths(APP_DATA, channelConfig('dev'));
    expect(paths.userData).toBe(`${APP_DATA}/Spark Outpost Dev`);
    for (const inside of [paths.postgresData, paths.postgresPassword, paths.backups, paths.logs]) {
      expect(inside.startsWith(`${paths.userData}/`)).toBe(true);
    }
    expect(channelPaths(APP_DATA, channelConfig('prod')).userData).toBe(
      `${APP_DATA}/Spark Outpost`,
    );
  });
});
