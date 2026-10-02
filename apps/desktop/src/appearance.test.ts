import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appearanceFile, readSavedTheme, saveTheme } from './appearance.ts';
import { isThemeName, themeArgs, themeFromArgs } from './theme-arg.ts';

const folders: string[] = [];

function folder(): string {
  const created = mkdtempSync(path.join(os.tmpdir(), 'spark-appearance-'));
  folders.push(created);
  return created;
}

afterEach(() => {
  for (const created of folders.splice(0)) rmSync(created, { recursive: true, force: true });
});

describe('saved theme', () => {
  it('reads back the theme it saved', async () => {
    const file = appearanceFile(folder());
    await saveTheme(file, 'fjord');
    expect(await readSavedTheme(file)).toBe('fjord');
  });

  it('has no theme before one is saved or when the file is damaged', async () => {
    const dir = folder();
    const file = appearanceFile(dir);
    expect(await readSavedTheme(file)).toBeNull();
    writeFileSync(file, '{"theme": "../../etc"}');
    expect(await readSavedTheme(file)).toBeNull();
    writeFileSync(file, 'not json');
    expect(await readSavedTheme(file)).toBeNull();
  });
});

describe('theme handed to the window', () => {
  it('round-trips through the renderer arguments', () => {
    expect(themeFromArgs(['--type=renderer', ...themeArgs('apricot')])).toBe('apricot');
    expect(themeArgs(null)).toEqual([]);
    expect(themeFromArgs(['--type=renderer'])).toBeNull();
  });

  it('accepts only plain theme names', () => {
    expect(isThemeName('graphite')).toBe(true);
    for (const value of ['', 'Fjord', 'a b', '<script>', 'x'.repeat(25), 7, null]) {
      expect(isThemeName(value)).toBe(false);
    }
    expect(themeFromArgs(['--spark-theme=<img>'])).toBeNull();
  });
});
