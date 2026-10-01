import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ShortcutAction = 'quick' | 'sessions';

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = ['quick', 'sessions'];

export type IslandPosition = { docked: true } | { docked: false; x: number; y: number };

export interface CompanionSettings {
  enabled: boolean;
  calm: boolean;
  shortcuts: Record<ShortcutAction, string>;
  position: IslandPosition;
}

export const DEFAULT_SHORTCUTS: Readonly<Record<ShortcutAction, string>> = {
  quick: 'Alt+Space',
  sessions: 'Alt+Shift+Space',
};

export const DEFAULT_SETTINGS: CompanionSettings = {
  enabled: true,
  calm: true,
  shortcuts: { ...DEFAULT_SHORTCUTS },
  position: { docked: true },
};

const MODIFIERS = new Set([
  'Command',
  'Cmd',
  'Control',
  'Ctrl',
  'CommandOrControl',
  'CmdOrCtrl',
  'Alt',
  'Option',
  'AltGr',
  'Shift',
  'Super',
  'Meta',
]);

const NAMED_KEYS = new Set([
  'Space',
  'Tab',
  'Enter',
  'Return',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Up',
  'Down',
  'Left',
  'Right',
  'Escape',
  'Esc',
  'Plus',
]);

function isKey(token: string): boolean {
  if (/^[A-Z0-9]$/.test(token)) return true;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(token)) return true;
  if (/^[`\-=[\]\\;',./]$/.test(token)) return true;
  return NAMED_KEYS.has(token);
}

export function isAccelerator(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 60) return false;
  const tokens = value.split('+');
  const key = tokens.at(-1) ?? '';
  const modifiers = tokens.slice(0, -1);
  if (modifiers.length === 0 || !isKey(key)) return false;
  if (new Set(modifiers).size !== modifiers.length) return false;
  return modifiers.every((token) => MODIFIERS.has(token));
}

function parsePosition(value: unknown): IslandPosition {
  if (!value || typeof value !== 'object') return { docked: true };
  const record = value as Record<string, unknown>;
  const { x, y } = record;
  if (record.docked !== false || typeof x !== 'number' || typeof y !== 'number') {
    return { docked: true };
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { docked: true };
  return { docked: false, x: Math.round(x), y: Math.round(y) };
}

function parseShortcuts(value: unknown): Record<ShortcutAction, string> {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const shortcuts = { ...DEFAULT_SHORTCUTS };
  for (const action of SHORTCUT_ACTIONS) {
    const saved = record[action];
    if (isAccelerator(saved)) shortcuts[action] = saved;
  }
  return shortcuts.quick === shortcuts.sessions ? { ...DEFAULT_SHORTCUTS } : shortcuts;
}

function savedFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function parseSettings(raw: string | null): CompanionSettings {
  if (!raw) return { ...DEFAULT_SETTINGS, shortcuts: { ...DEFAULT_SHORTCUTS } };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return parseSettings(null);
  }
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    enabled: savedFlag(record.enabled, DEFAULT_SETTINGS.enabled),
    calm: savedFlag(record.calm, DEFAULT_SETTINGS.calm),
    shortcuts: parseShortcuts(record.shortcuts),
    position: parsePosition(record.position),
  };
}

export function settingsFile(userData: string): string {
  return path.join(userData, 'companion.json');
}

export async function loadSettings(file: string): Promise<CompanionSettings> {
  const raw = await readFile(file, 'utf8').catch(() => null);
  return parseSettings(raw);
}

export async function saveSettings(file: string, settings: CompanionSettings): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}
