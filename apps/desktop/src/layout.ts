import path from 'node:path';

export interface AppLayout {
  serverDir: string;
  webRoot: string;
  tmuxBin: string;
  macControlBin: string;
  calendarBin: string;
  calendarSeedBin: string | null;
  voiceBin: string;
  voiceModels: string;
}

export interface LayoutSource {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
  arch?: string;
}

export function appLayout(source: LayoutSource): AppLayout {
  const { isPackaged, appPath, resourcesPath, arch = process.arch } = source;
  if (isPackaged) {
    return {
      serverDir: path.join(resourcesPath, 'server'),
      webRoot: path.join(resourcesPath, 'web'),
      tmuxBin: path.join(resourcesPath, 'tmux/bin/tmux'),
      macControlBin: path.join(resourcesPath, 'mac-control/bin/spark-mac-control'),
      calendarBin: path.join(resourcesPath, 'calendar/bin/spark-calendar'),
      calendarSeedBin: null,
      voiceBin: path.join(resourcesPath, 'voice/bin/spark-voice'),
      voiceModels: path.join(resourcesPath, 'voice/models'),
    };
  }
  const repoRoot = path.resolve(appPath, '../..');
  return {
    serverDir: path.join(repoRoot, 'apps/server'),
    webRoot: path.join(repoRoot, 'apps/web/dist'),
    tmuxBin: path.join(repoRoot, '.local/tmux', arch, 'bin/tmux'),
    macControlBin: path.join(repoRoot, '.local/mac-control', arch, 'spark-mac-control'),
    calendarBin: path.join(repoRoot, '.local/calendar', arch, 'spark-calendar'),
    calendarSeedBin: path.join(repoRoot, '.local/calendar', arch, 'spark-calendar-seed'),
    voiceBin: path.join(repoRoot, '.local/voice', arch, 'spark-voice'),
    voiceModels: path.join(repoRoot, '.local/voice', arch, 'models'),
  };
}
