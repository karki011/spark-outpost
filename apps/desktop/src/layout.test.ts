import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appLayout } from './layout.ts';

function native(
  layout: Record<string, string | null>,
  toPath: (file: string) => string = path.join,
) {
  return Object.fromEntries(
    Object.entries(layout).map(([key, value]) => [key, value === null ? null : toPath(value)]),
  );
}

describe('appLayout', () => {
  it('runs the server and web app from the checkout when started from source', () => {
    expect(
      appLayout({
        isPackaged: false,
        appPath: '/repo/apps/desktop',
        resourcesPath: '/electron/Resources',
        arch: 'arm64',
        platform: 'darwin',
      }),
    ).toEqual(
      native(
        {
          serverDir: '/repo/apps/server',
          webRoot: '/repo/apps/web/dist',
          tmuxBin: '/repo/.local/tmux/arm64/bin/tmux',
          cloudflaredBin: '/repo/.local/cloudflared/arm64/bin/cloudflared',
          macControlBin: '/repo/.local/mac-control/arm64/spark-mac-control',
          calendarBin: '/repo/.local/calendar/arm64/spark-calendar',
          calendarSeedBin: '/repo/.local/calendar/arm64/spark-calendar-seed',
          voiceBin: '/repo/.local/voice/arm64/spark-voice',
          voiceModels: '/repo/.local/voice/arm64/models',
          noActivateAddon: '/repo/.local/no-activate/arm64/no-activate.node',
          winHelperBin: '/repo/.local/win-helper/arm64/spark-win-helper.exe',
          googleClientFile: '/repo/.local/google-oauth-client.json',
          microsoftClientFile: '/repo/.local/microsoft-oauth-client.json',
          zoomClientFile: '/repo/.local/zoom-oauth-client.json',
          cloudflareClientFile: '/repo/.local/cloudflare-oauth-client.json',
          shareWorkerFile: '/repo/apps/desktop/dist/share-worker.mjs',
          slackClientIdFile: '/repo/.local/slack-client-id',
        },
        path.resolve,
      ),
    );
  });

  it('names the Windows cloudflared, packaged and from source', () => {
    const source = { appPath: '/repo/apps/desktop', resourcesPath: '/app/resources' };
    const platform = 'win32' as const;
    expect(appLayout({ ...source, isPackaged: true, platform }).cloudflaredBin).toBe(
      path.join('/app/resources', 'cloudflared/bin/cloudflared.exe'),
    );
    expect(appLayout({ ...source, isPackaged: false, arch: 'x64', platform }).cloudflaredBin).toBe(
      path.resolve('/repo/.local/cloudflared/win-x64/bin/cloudflared.exe'),
    );
  });

  it('runs them from the app bundle resources when packaged', () => {
    expect(
      appLayout({
        isPackaged: true,
        appPath: '/Applications/Spark Outpost.app/Contents/Resources/app',
        resourcesPath: '/Applications/Spark Outpost.app/Contents/Resources',
        platform: 'darwin',
      }),
    ).toEqual(
      native({
        serverDir: '/Applications/Spark Outpost.app/Contents/Resources/server',
        webRoot: '/Applications/Spark Outpost.app/Contents/Resources/web',
        tmuxBin: '/Applications/Spark Outpost.app/Contents/Resources/tmux/bin/tmux',
        cloudflaredBin:
          '/Applications/Spark Outpost.app/Contents/Resources/cloudflared/bin/cloudflared',
        macControlBin:
          '/Applications/Spark Outpost.app/Contents/Resources/mac-control/bin/spark-mac-control',
        calendarBin:
          '/Applications/Spark Outpost.app/Contents/Resources/calendar/bin/spark-calendar',
        calendarSeedBin: null,
        voiceBin: '/Applications/Spark Outpost.app/Contents/Resources/voice/bin/spark-voice',
        voiceModels: '/Applications/Spark Outpost.app/Contents/Resources/voice/models',
        noActivateAddon:
          '/Applications/Spark Outpost.app/Contents/Resources/no-activate/no-activate.node',
        winHelperBin:
          '/Applications/Spark Outpost.app/Contents/Resources/win-helper/spark-win-helper.exe',
        googleClientFile: null,
        microsoftClientFile: null,
        zoomClientFile: null,
        cloudflareClientFile: null,
        shareWorkerFile:
          '/Applications/Spark Outpost.app/Contents/Resources/app/dist/share-worker.mjs',
        slackClientIdFile: null,
      }),
    );
  });
});
