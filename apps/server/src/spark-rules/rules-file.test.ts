import { describe, expect, it } from 'vitest';
import { changedRulesText, parseRulesFile, RulesFileError } from './rules-file.ts';

const json = (value: unknown) => JSON.stringify(value);

describe('parseRulesFile', () => {
  it('reads the three lists and applies only rules Spark knows', () => {
    const parsed = parseRulesFile(
      json({
        permissions: {
          allow: ['Gh(release create)', 'Gh(Release Create)'],
          ask: ['WriteOutside', 'WriteOutside'],
          deny: ['Push', 'Gh(*)', 'Bash(rm:*)', 7],
        },
      }),
    );
    expect(parsed.malformed).toBe(false);
    expect(parsed.lists).toEqual({
      allow: ['Gh(release create)'],
      ask: ['WriteOutside'],
      deny: ['Push', 'Gh(*)'],
    });
    expect(parsed.problems).toEqual([
      `"Gh(Release Create)" in allow isn't a Spark rule, so it is not applied`,
      `"Bash(rm:*)" in deny isn't a Spark rule, so it is not applied`,
      `An entry that is not text in deny isn't a Spark rule, so it is not applied`,
    ]);
  });

  it('reports unknown keys and keeps going', () => {
    const parsed = parseRulesFile(json({ theme: 'dark', permissions: { deny: [], extra: [] } }));
    expect(parsed.malformed).toBe(false);
    expect(parsed.problems).toEqual([
      `"theme" is kept but Spark doesn't use it`,
      `permissions."extra" is kept but Spark doesn't use it`,
    ]);
  });

  it('treats a missing permissions object as no rules', () => {
    expect(parseRulesFile('{}')).toEqual({
      lists: { allow: [], ask: [], deny: [] },
      problems: [],
      malformed: false,
    });
  });

  it.each([
    ['not JSON', '{ "permissions": '],
    ['an array', '[]'],
    ['permissions as a list', json({ permissions: [] })],
    ['a list that is a string', json({ permissions: { deny: 'Push' } })],
  ])('calls %s malformed', (_name, text) => {
    expect(parseRulesFile(text).malformed).toBe(true);
  });

  it('applies at most 200 rules per list and 512 characters per rule', () => {
    const long = `Gh(${'a'.repeat(300)} ${'b'.repeat(300)})`;
    const many = Array.from({ length: 205 }, (_, index) => `Gh(x${index} y)`);
    const parsed = parseRulesFile(json({ permissions: { allow: many, deny: [long] } }));
    expect(parsed.lists.allow).toHaveLength(200);
    expect(parsed.lists.deny).toEqual([]);
    expect(parsed.problems).toContain('allow holds more than 200 rules; the rest are not applied');
  });
});

describe('changedRulesText', () => {
  it('keeps unknown keys and unrecognised rules while it adds and removes', () => {
    const text = json({
      theme: 'dark',
      permissions: { deny: ['Gh(*)', 'Mystery'], allow: ['Gh(run cancel)'], extra: 1 },
    });
    const changed = JSON.parse(
      changedRulesText(text, {
        add: [['allow', 'Gh(release create)']],
        remove: [['allow', 'Gh(run cancel)']],
      }),
    );
    expect(changed).toEqual({
      theme: 'dark',
      permissions: {
        deny: ['Gh(*)', 'Mystery'],
        allow: ['Gh(release create)'],
        ask: [],
        extra: 1,
      },
    });
  });

  it('starts an empty file when there is none', () => {
    expect(JSON.parse(changedRulesText(null, { add: [['deny', 'Push']] }))).toEqual({
      permissions: { allow: [], ask: [], deny: ['Push'] },
    });
  });

  it('refuses to rewrite a malformed file', () => {
    expect(() => changedRulesText('{ "permissions": [', {})).toThrow(RulesFileError);
  });
});
