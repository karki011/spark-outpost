import { describe, expect, it } from 'vitest';
import { appLayout } from './layout.ts';

describe('appLayout', () => {
  it('runs the server and web app from the checkout when started from source', () => {
    expect(
      appLayout({
        isPackaged: false,
        appPath: '/repo/apps/desktop',
        resourcesPath: '/electron/Resources',
        arch: 'arm64',
      }),
    ).toEqual({
      serverDir: '/repo/apps/server',
      webRoot: '/repo/apps/web/dist',
      tmuxBin: '/repo/.local/tmux/arm64/bin/tmux',
      macControlBin: '/repo/.local/mac-control/arm64/spark-mac-control',
      calendarBin: '/repo/.local/calendar/arm64/spark-calendar',
      calendarSeedBin: '/repo/.local/calendar/arm64/spark-calendar-seed',
      voiceBin: '/repo/.local/voice/arm64/spark-voice',
      voiceModels: '/repo/.local/voice/arm64/models',
      noActivateAddon: '/repo/.local/no-activate/arm64/no-activate.node',
      googleClientFile: '/repo/.local/google-oauth-client.json',
    });
  });

  it('runs them from the app bundle resources when packaged', () => {
    expect(
      appLayout({
        isPackaged: true,
        appPath: '/Applications/Spark Outpost.app/Contents/Resources/app',
        resourcesPath: '/Applications/Spark Outpost.app/Contents/Resources',
      }),
    ).toEqual({
      serverDir: '/Applications/Spark Outpost.app/Contents/Resources/server',
      webRoot: '/Applications/Spark Outpost.app/Contents/Resources/web',
      tmuxBin: '/Applications/Spark Outpost.app/Contents/Resources/tmux/bin/tmux',
      macControlBin:
        '/Applications/Spark Outpost.app/Contents/Resources/mac-control/bin/spark-mac-control',
      calendarBin: '/Applications/Spark Outpost.app/Contents/Resources/calendar/bin/spark-calendar',
      calendarSeedBin: null,
      voiceBin: '/Applications/Spark Outpost.app/Contents/Resources/voice/bin/spark-voice',
      voiceModels: '/Applications/Spark Outpost.app/Contents/Resources/voice/models',
      noActivateAddon:
        '/Applications/Spark Outpost.app/Contents/Resources/no-activate/no-activate.node',
      googleClientFile: null,
    });
  });
});
