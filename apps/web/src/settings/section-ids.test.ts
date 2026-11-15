import { describe, expect, it } from 'vitest';
import {
  SETTINGS_PAGE_IDS,
  SETTINGS_PART_PAGES,
  pageOf,
  partOf,
  type SettingsPart,
} from './section-ids.ts';
import { SETTINGS_SECTIONS } from './settings-sections.tsx';

describe('settings section ids', () => {
  it('lists every settings page in the order the dialog shows them', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([...SETTINGS_PAGE_IDS]);
  });

  it('keeps each old section id as a part of the page that now holds it', () => {
    for (const [part, page] of Object.entries(SETTINGS_PART_PAGES)) {
      const entry = SETTINGS_SECTIONS.find((section) => section.id === page);
      const parts = entry && 'parts' in entry ? entry.parts.map((candidate) => candidate.id) : [];
      expect(parts, part).toContain(part);
      expect(pageOf(part as SettingsPart)).toBe(page);
      expect(partOf(part as SettingsPart)).toBe(part);
    }
    expect(pageOf('chats')).toBe('chats');
    expect(partOf('chats')).toBeNull();
  });
});
