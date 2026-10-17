import { describe, expect, it } from 'vitest';
import { notesSnippet } from './google/map.ts';
import { linkFreeSnippet } from './snippet.ts';

describe('the notes snippet', () => {
  it('drops a Google link together with its label and keeps label lines like Topics:', () => {
    const description =
      '<a href="https://acme.zoom.us/j/1">Join Zoom Meeting</a><br>Topics:<br>Roadmap &amp; hiring';
    expect(notesSnippet(description)).toBe('Topics: Roadmap & hiring');
  });

  it('leaves no bracket behind when Mac notes wrap a link', () => {
    expect(linkFreeSnippet('Join Zoom Meeting (https://acme.zoom.us/j/1)\nTopics:\nRoadmap')).toBe(
      'Join Zoom Meeting Topics: Roadmap',
    );
    expect(linkFreeSnippet('Daily sync https://acme.zoom.us/j/123 <https://x.test/a>')).toBe(
      'Daily sync',
    );
  });

  it('clips at a word', () => {
    const snippet = linkFreeSnippet('word '.repeat(80));
    expect(snippet.length).toBeLessThanOrEqual(160);
    expect(snippet).toMatch(/word…$/);
  });
});
