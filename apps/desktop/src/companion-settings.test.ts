import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  isAccelerator,
  loadSettings,
  parseSettings,
  saveSettings,
} from './companion-settings.ts';

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('companion shortcut config', () => {
  it('accepts modifier + key accelerators Electron understands', () => {
    for (const value of ['Alt+Space', 'Alt+Shift+Space', 'CommandOrControl+K', 'Control+Alt+F5']) {
      expect(isAccelerator(value)).toBe(true);
    }
  });

  it('rejects bare keys, unknown modifiers and repeats', () => {
    for (const value of ['Space', 'K', 'Hyper+K', 'Alt+Alt+K', 'Alt+', 'Alt+ä', '', 42]) {
      expect(isAccelerator(value)).toBe(false);
    }
  });
});

describe('companion settings file', () => {
  it('is on by default with the default shortcuts and a docked island', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ enabled: true, sound: false });
  });

  it('keeps a choice the user already saved, ignores the old Calm mode flag', () => {
    expect(parseSettings(JSON.stringify({ enabled: false, calm: false }))).toEqual({
      ...DEFAULT_SETTINGS,
      enabled: false,
    });
    expect(parseSettings(JSON.stringify({ position: { docked: true } }))).toMatchObject({
      enabled: true,
    });
  });

  it('keeps valid values and repairs broken ones', () => {
    const parsed = parseSettings(
      JSON.stringify({
        enabled: false,
        shortcuts: { quick: 'Alt+J', sessions: 'Space' },
        position: { docked: false, x: 120.4, y: 'top' },
      }),
    );
    expect(parsed).toEqual({
      enabled: false,
      shortcuts: { quick: 'Alt+J', sessions: 'Alt+Shift+Space' },
      position: { docked: true },
      sound: false,
      islandSize: 'medium',
    });
  });

  it('keeps a saved island size and ignores an unknown one', () => {
    expect(parseSettings(JSON.stringify({ islandSize: 'large' })).islandSize).toBe('large');
    expect(parseSettings(JSON.stringify({ islandSize: 'huge' })).islandSize).toBe('medium');
  });

  it('falls back to the defaults when both shortcuts collide', () => {
    const parsed = parseSettings(
      JSON.stringify({ shortcuts: { quick: 'Alt+J', sessions: 'Alt+J' } }),
    );
    expect(parsed.shortcuts).toEqual(DEFAULT_SETTINGS.shortcuts);
  });

  it('round-trips through the user data folder', async () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'spark-companion-'));
    folders.push(folder);
    const file = path.join(folder, 'nested', 'companion.json');
    const settings = {
      ...DEFAULT_SETTINGS,
      enabled: false,
      position: { docked: false as const, x: 40, y: 200 },
      sound: true,
      islandSize: 'small' as const,
    };
    await saveSettings(file, settings);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(settings);
    expect(await loadSettings(file)).toEqual(settings);
    expect(await loadSettings(path.join(folder, 'missing.json'))).toEqual(DEFAULT_SETTINGS);
  });
});
