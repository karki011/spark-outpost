import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  VOICE_DEFAULT_SETTINGS,
  voiceSettingsSchema,
  type VoiceSettings,
} from '@spark-outpost/contracts';
import { isAccelerator } from '../companion-settings.ts';

export const voiceSettingsFile = (userData: string) => path.join(userData, 'voice-settings.json');

export function parseVoiceSettings(raw: string | null): VoiceSettings {
  if (!raw) return { ...VOICE_DEFAULT_SETTINGS };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...VOICE_DEFAULT_SETTINGS };
  }
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const merged = voiceSettingsSchema.safeParse({
    ...VOICE_DEFAULT_SETTINGS,
    ...record,
    model: VOICE_DEFAULT_SETTINGS.model,
  });
  if (!merged.success) return { ...VOICE_DEFAULT_SETTINGS };
  const settings = merged.data;
  if (!isAccelerator(settings.shortcut)) settings.shortcut = VOICE_DEFAULT_SETTINGS.shortcut;
  return {
    enabled: settings.enabled,
    speakAnswers: settings.speakAnswers,
    shortcutMode: settings.shortcutMode,
    shortcut: settings.shortcut,
    hold: settings.hold,
    model: settings.model,
  };
}

export async function loadVoiceSettings(file: string): Promise<VoiceSettings> {
  return parseVoiceSettings(await readFile(file, 'utf8').catch(() => null));
}

export async function saveVoiceSettings(file: string, settings: VoiceSettings): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(settings, null, 2));
  await rename(temporary, file);
}
