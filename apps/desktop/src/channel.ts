import path from 'node:path';

export type Channel = 'dev' | 'prod';

export interface ChannelConfig {
  channel: Channel;
  appName: string;
  appId: string;
  badge: string | null;
  dataFolderName: string;
  keychainService: string;
  linkScheme: string;
  branchPrefix: string;
  autoUpdate: boolean;
}

const CHANNELS: Record<Channel, ChannelConfig> = {
  prod: {
    channel: 'prod',
    appName: 'Spark Outpost',
    appId: 'ai.spark-outpost.app',
    badge: null,
    dataFolderName: 'Spark Outpost',
    keychainService: 'Spark Outpost',
    linkScheme: 'spark-outpost',
    branchPrefix: 'spark',
    autoUpdate: true,
  },
  dev: {
    channel: 'dev',
    appName: 'Spark Outpost Dev',
    appId: 'ai.spark-outpost.app.dev',
    badge: 'DEV',
    dataFolderName: 'Spark Outpost Dev',
    keychainService: 'Spark Outpost Dev',
    linkScheme: 'spark-outpost-dev',
    branchPrefix: 'spark-dev',
    autoUpdate: false,
  },
};

export function resolveChannel(isPackaged: boolean): Channel {
  return isPackaged ? 'prod' : 'dev';
}

export function channelConfig(channel: Channel): ChannelConfig {
  return CHANNELS[channel];
}

export interface ChannelPaths {
  userData: string;
  postgresData: string;
  postgresPassword: string;
  backups: string;
  logs: string;
}

export function channelPaths(appDataDir: string, config: ChannelConfig): ChannelPaths {
  const userData = path.join(appDataDir, config.dataFolderName);
  return {
    userData,
    postgresData: path.join(userData, 'postgres'),
    postgresPassword: path.join(userData, 'postgres-password'),
    backups: path.join(userData, 'backups'),
    logs: path.join(userData, 'logs'),
  };
}
