import { desktopBrowser, desktopMacControl, sparkDesktop } from '../desktop/desktop-bridge.ts';
import { desktopSpeech } from '../voice/speech-bridge.ts';

export const SETTINGS_SECTION_IDS = [
  'spark',
  'assistant',
  'voice',
  'look',
  'ai',
  'models',
  'usage',
  'projects',
  'chats',
  'pulls',
  'rules',
  'tools',
  'mcp',
  'mac',
  'browser',
  'notifications',
  'updates',
  'help',
  'reset',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTION_IDS)[number];

const AVAILABLE: Partial<Record<SettingsSection, () => boolean>> = {
  voice: () => desktopSpeech() !== null,
  mac: () => desktopMacControl() !== null,
  browser: () => desktopBrowser() !== null,
  updates: () => Boolean(sparkDesktop()?.updates),
};

export function sectionAvailable(section: SettingsSection): boolean {
  return AVAILABLE[section]?.() ?? true;
}
