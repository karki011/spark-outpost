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
      islandSize: 'full',
      islandSizePicked: false,
      autoExpand: true,
      hideInShare: true,
      notify: true,
    });
  });

  it('is the full island unless the user chose a size', () => {
    const size = (saved: object) => parseSettings(JSON.stringify(saved)).islandSize;
    expect(size({})).toBe('full');
    expect(size({ islandSize: 'huge' })).toBe('full');
    expect(size({ islandSize: 'medium' })).toBe('full');
    expect(size({ islandSize: 'medium', islandSizeChosen: true })).toBe('medium');
    expect(size({ islandSize: 'small' })).toBe('small');
    expect(parseSettings(JSON.stringify({ islandSize: 'small' })).islandSizePicked).toBe(true);
  });

  it('moves a saved large island to full once, then keeps a size picked afterwards', () => {
    const size = (saved: object) => parseSettings(JSON.stringify(saved)).islandSize;
    expect(size({ islandSize: 'large' })).toBe('full');
    expect(size({ islandSize: 'large', islandSizeChosen: true })).toBe('full');
    expect(size({ islandSize: 'large', islandSizePicked: true })).toBe('large');
    expect(size({ islandSize: 'full', islandSizePicked: true })).toBe('full');
  });

  it('keeps a picked extra large island', () => {
    const saved = parseSettings(JSON.stringify({ islandSize: 'xlarge', islandSizePicked: true }));
    expect(saved).toMatchObject({ islandSize: 'xlarge', islandSizePicked: true });
    expect(parseSettings(JSON.stringify(saved)).islandSize).toBe('xlarge');
    expect(parseSettings(JSON.stringify({ islandSize: 'xlarge' })).islandSize).toBe('full');
  });

  it('opens requests by itself unless that was turned off', () => {
    expect(parseSettings('{}').autoExpand).toBe(true);
    expect(parseSettings(JSON.stringify({ autoExpand: false })).autoExpand).toBe(false);
    expect(parseSettings(JSON.stringify({ autoExpand: 'no' })).autoExpand).toBe(true);
  });

  it('hides the island from screen sharing unless that was turned off', () => {
    expect(parseSettings('{}').hideInShare).toBe(true);
    expect(parseSettings(JSON.stringify({ hideInShare: false })).hideInShare).toBe(false);
    expect(parseSettings(JSON.stringify({ hideInShare: 'no' })).hideInShare).toBe(true);
  });

  it('notifies on this Mac unless that was turned off', () => {
    expect(parseSettings('{}').notify).toBe(true);
    expect(parseSettings(JSON.stringify({ notify: false })).notify).toBe(false);
    expect(parseSettings(JSON.stringify({ notify: 0 })).notify).toBe(true);
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
      islandSizePicked: true,
      autoExpand: false,
      hideInShare: false,
      notify: false,
    };
    await saveSettings(file, settings);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(settings);
    expect(await loadSettings(file)).toEqual(settings);
    expect(await loadSettings(path.join(folder, 'missing.json'))).toEqual(DEFAULT_SETTINGS);
  });
});
