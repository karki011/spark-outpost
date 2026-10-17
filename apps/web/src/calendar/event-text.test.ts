import { describe, expect, it } from 'vitest';
import { notesSnippet, peopleLine } from './event-text.ts';

describe('notesSnippet', () => {
  it('drops links and the labels they leave behind', () => {
    expect(notesSnippet('Join: https://teams.microsoft.com/l/meetup-join/19')).toBe('');
    expect(notesSnippet('Agenda first.\nZoom link -\nhttps://acme.zoom.us/j/1')).toBe(
      'Agenda first.',
    );
    expect(notesSnippet('Daily sync https://acme.zoom.us/j/123')).toBe('Daily sync');
  });

  it('keeps sentences that end in a colon after a full stop, and joins lines', () => {
    expect(notesSnippet('We meet weekly. Bring this:\nthe roadmap')).toBe(
      'We meet weekly. Bring this: the roadmap',
    );
  });

  it('clips long notes', () => {
    const snippet = notesSnippet('word '.repeat(80));
    expect(snippet).toHaveLength(160);
    expect(snippet.endsWith('…')).toBe(true);
  });
});

describe('peopleLine', () => {
  it('names one or two people, then counts the rest', () => {
    expect(peopleLine(['Alex W'], 2)).toBe('Alex W');
    expect(peopleLine(['Alex W', 'Ivan M'], 3)).toBe('Alex W and Ivan M');
    expect(peopleLine(['Julia K', 'Ivan M', 'Sam', 'Lee'], 5)).toBe('Julia K, Ivan M +2 more');
  });

  it('falls back to a count without names, and says nothing for one person', () => {
    expect(peopleLine([], 4)).toBe('4 people');
    expect(peopleLine([], 1)).toBeNull();
  });
});
