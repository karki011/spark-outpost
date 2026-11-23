import { app } from 'electron';
import { isBetaVersion } from '@spark-outpost/contracts';
import type { ChannelConfig } from './channel.ts';
import { aboutVersion } from './help-menu.ts';

export function setAppIdentity(config: ChannelConfig, iconPath: string): void {
  app.setName(config.appName);
  if (process.platform === 'win32') app.setAppUserModelId(config.appId);
  app.setAboutPanelOptions({
    applicationName: config.appName,
    ...aboutVersion(app.getVersion(), isBetaVersion(app.getVersion())),
    iconPath,
  });
}
