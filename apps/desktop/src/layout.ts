import path from 'node:path';
import { GOOGLE_CLIENT_FILE_NAME } from './google-client.ts';
import { MICROSOFT_CLIENT_FILE_NAME } from './microsoft-client.ts';
import { CLOUDFLARE_CLIENT_FILE_NAME, SHARE_WORKER_FILE } from './cloudflare-client.ts';
import { ZOOM_CLIENT_FILE_NAME } from './zoom-client.ts';
import { SLACK_CLIENT_ID_FILE_NAME } from './slack-sign-in.ts';
import { WIN_HELPER_EXE } from './win-helper/protocol.ts';
import { cloudflaredFile, cloudflaredFolder } from './cloudflared.ts';

export interface AppLayout {
  serverDir: string;
  webRoot: string;
  tmuxBin: string;
  cloudflaredBin: string;
  macControlBin: string;
  calendarBin: string;
  calendarSeedBin: string | null;
  voiceBin: string;
  voiceModels: string;
  noActivateAddon: string;
  winHelperBin: string;
  googleClientFile: string | null;
  microsoftClientFile: string | null;
  zoomClientFile: string | null;
  cloudflareClientFile: string | null;
  shareWorkerFile: string;
  slackClientIdFile: string | null;
}

export interface LayoutSource {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
  arch?: string;
  platform?: NodeJS.Platform;
}

export function appLayout(source: LayoutSource): AppLayout {
  const { isPackaged, appPath, resourcesPath, arch = process.arch } = source;
  const platform = source.platform ?? process.platform;
  const cloudflared = path.join('bin', cloudflaredFile(platform));
  if (isPackaged) {
    return {
      serverDir: path.join(resourcesPath, 'server'),
      webRoot: path.join(resourcesPath, 'web'),
      tmuxBin: path.join(resourcesPath, 'tmux/bin/tmux'),
      cloudflaredBin: path.join(resourcesPath, 'cloudflared', cloudflared),
      macControlBin: path.join(resourcesPath, 'mac-control/bin/spark-mac-control'),
      calendarBin: path.join(resourcesPath, 'calendar/bin/spark-calendar'),
      calendarSeedBin: null,
      voiceBin: path.join(resourcesPath, 'voice/bin/spark-voice'),
      voiceModels: path.join(resourcesPath, 'voice/models'),
      noActivateAddon: path.join(resourcesPath, 'no-activate/no-activate.node'),
      winHelperBin: path.join(resourcesPath, 'win-helper', WIN_HELPER_EXE),
      googleClientFile: null,
      microsoftClientFile: null,
      zoomClientFile: null,
      cloudflareClientFile: null,
      shareWorkerFile: path.join(appPath, SHARE_WORKER_FILE),
      slackClientIdFile: null,
    };
  }
  const repoRoot = path.resolve(appPath, '../..');
  return {
    serverDir: path.join(repoRoot, 'apps/server'),
    webRoot: path.join(repoRoot, 'apps/web/dist'),
    tmuxBin: path.join(repoRoot, '.local/tmux', arch, 'bin/tmux'),
    cloudflaredBin: path.join(
      repoRoot,
      '.local/cloudflared',
      cloudflaredFolder(platform, arch),
      cloudflared,
    ),
    macControlBin: path.join(repoRoot, '.local/mac-control', arch, 'spark-mac-control'),
    calendarBin: path.join(repoRoot, '.local/calendar', arch, 'spark-calendar'),
    calendarSeedBin: path.join(repoRoot, '.local/calendar', arch, 'spark-calendar-seed'),
    voiceBin: path.join(repoRoot, '.local/voice', arch, 'spark-voice'),
    voiceModels: path.join(repoRoot, '.local/voice', arch, 'models'),
    noActivateAddon: path.join(repoRoot, '.local/no-activate', arch, 'no-activate.node'),
    winHelperBin: path.join(repoRoot, '.local/win-helper', arch, WIN_HELPER_EXE),
    googleClientFile: path.join(repoRoot, '.local', GOOGLE_CLIENT_FILE_NAME),
    microsoftClientFile: path.join(repoRoot, '.local', MICROSOFT_CLIENT_FILE_NAME),
    zoomClientFile: path.join(repoRoot, '.local', ZOOM_CLIENT_FILE_NAME),
    cloudflareClientFile: path.join(repoRoot, '.local', CLOUDFLARE_CLIENT_FILE_NAME),
    shareWorkerFile: path.join(appPath, SHARE_WORKER_FILE),
    slackClientIdFile: path.join(repoRoot, '.local', SLACK_CLIENT_ID_FILE_NAME),
  };
}
