import { describe, expect, it } from 'vitest';
import { isMarkdown, languageOf, splitFrontMatter } from './front-matter.ts';

describe('splitFrontMatter', () => {
  it('reads simple properties and returns the body', () => {
    const file = splitFrontMatter(
      '---\nname: add-provider\ndescription: "Adds one"\n---\n# Title\n',
    );
    expect(file.properties).toEqual([
      ['name', 'add-provider'],
      ['description', 'Adds one'],
    ]);
    expect(file.body).toBe('# Title\n');
  });

  it('joins folded and list values onto their property', () => {
    const file = splitFrontMatter(
      '---\ndescription: >\n  first line\n  second\ntools:\n  - Read\n  - Edit\n---\nBody',
    );
    expect(file.properties).toEqual([
      ['description', 'first line second'],
      ['tools', 'Read Edit'],
    ]);
  });

  it('leaves text without front matter alone', () => {
    expect(splitFrontMatter('# Only\n---\n')).toEqual({ properties: [], body: '# Only\n---\n' });
  });
});

describe('languageOf', () => {
  it('knows markdown and common config files', () => {
    expect(isMarkdown('CLAUDE.md')).toBe(true);
    expect(languageOf('.claude/skills/x/SKILL.md')).toBe('markdown');
    expect(languageOf('settings.json')).toBe('json');
    expect(languageOf('notes.txt')).toBeUndefined();
  });
});
