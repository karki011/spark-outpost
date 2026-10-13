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
    });
  });
});
