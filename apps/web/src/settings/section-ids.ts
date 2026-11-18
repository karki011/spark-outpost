import { desktopBrowser, desktopMacControl, sparkDesktop } from '../desktop/desktop-bridge.ts';
import { desktopSpeech } from '../voice/speech-bridge.ts';

export const SETTINGS_PAGE_IDS = [
  'spark',
  'assistant',
  'voice',
  'notifications',
  'ai',
  'usage',
  'projects',
  'chats',
  'pulls',
  'rules',
  'tools',
  'browser',
  'mac',
  'about',
] as const;

export type SettingsPage = (typeof SETTINGS_PAGE_IDS)[number];

export const SETTINGS_PART_PAGES = {
  look: 'spark',
  lock: 'spark',
  models: 'ai',
  mcp: 'tools',
  updates: 'about',
  help: 'about',
  reset: 'about',
} as const satisfies Record<string, SettingsPage>;

export type SettingsPart = keyof typeof SETTINGS_PART_PAGES;

export const SETTINGS_SECTION_IDS: readonly SettingsSection[] = [
  ...SETTINGS_PAGE_IDS,
  ...(Object.keys(SETTINGS_PART_PAGES) as SettingsPart[]),
];

export type SettingsSection = SettingsPage | SettingsPart;

function isPart(section: SettingsSection): section is SettingsPart {
  return section in SETTINGS_PART_PAGES;
}

export function pageOf(section: SettingsSection): SettingsPage {
  return isPart(section) ? SETTINGS_PART_PAGES[section] : section;
}

export function partOf(section: SettingsSection): SettingsPart | null {
  return isPart(section) ? section : null;
}

const AVAILABLE: Partial<Record<SettingsSection, () => boolean>> = {
  voice: () => desktopSpeech() !== null,
  mac: () => desktopMacControl() !== null,
  browser: () => desktopBrowser() !== null,
  updates: () => Boolean(sparkDesktop()?.updates),
  lock: () => Boolean(sparkDesktop()?.lock),
};

export function sectionAvailable(section: SettingsSection): boolean {
  return AVAILABLE[section]?.() ?? true;
}
