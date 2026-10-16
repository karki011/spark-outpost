import { describe, expect, it } from 'vitest';
import { searchSettings, type SearchableSection } from './settings-search.ts';

const SECTIONS: SearchableSection[] = [
  {
    id: 'chats',
    label: 'Chats & autonomy',
    groupLabel: 'Work',
    rows: ['How much Spark does alone', 'Warn when context is', 'Compact automatically at'],
  },
  {
    id: 'mac',
    label: 'Mac control',
    groupLabel: 'Mac',
    rows: ['Let agents control other Mac apps'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    groupLabel: 'Mac',
    rows: ['Morning brief', 'Island chimes', 'Dock badge and notifications'],
  },
  { id: 'reset', label: 'Reset', groupLabel: 'App', rows: ['Keep my API keys'] },
];

function labels(query: string): string[] {
  return searchSettings(query, SECTIONS).map((match) => match.row ?? `[${match.sectionLabel}]`);
}

describe('searchSettings', () => {
  it('finds nothing for an empty or blank query', () => {
    expect(searchSettings('', SECTIONS)).toEqual([]);
    expect(searchSettings('   ', SECTIONS)).toEqual([]);
  });

  it('matches a row label and names its section and group', () => {
    expect(searchSettings('morning brief', SECTIONS)).toEqual([
      {
        section: 'notifications',
        sectionLabel: 'Notifications',
        groupLabel: 'Mac',
        row: 'Morning brief',
      },
    ]);
  });

  it('ignores case, punctuation and accents', () => {
    expect(labels('MORNING-brief')).toEqual(['Morning brief']);
    expect(labels('mórning')).toEqual(['Morning brief']);
  });

  it('needs every word, each starting a word in the label', () => {
    expect(labels('brief morn')).toEqual(['Morning brief']);
    expect(labels('brief chimes')).toEqual([]);
  });

  it('falls back to text inside words after word starts', () => {
    expect(labels('ompact')).toEqual(['Compact automatically at']);
    expect(labels('auto')).toEqual(['[Chats & autonomy]', 'Compact automatically at']);
  });

  it('ranks labels that start with the query first', () => {
    expect(labels('notif')).toEqual(['[Notifications]', 'Dock badge and notifications']);
  });

  it('lists a section whose group matches after the sections that match by name', () => {
    expect(labels('mac')).toEqual([
      '[Mac control]',
      'Let agents control other Mac apps',
      '[Notifications]',
    ]);
  });

  it('does not match a row by its group or section name', () => {
    expect(labels('reset')).toEqual(['[Reset]']);
  });
});
