import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTION_IDS } from './section-ids.ts';
import { SETTINGS_SECTIONS } from './settings-sections.tsx';

describe('settings section ids', () => {
  it('lists every settings section in the order the dialog shows them', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([...SETTINGS_SECTION_IDS]);
  });
});
