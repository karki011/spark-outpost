import { describe, expect, it } from 'vitest';
import { descriptionsAlike, nameLikeness, similarTo, type CrewCandidate } from './similar.ts';

describe('how alike two names are', () => {
  it('treats case, spaces and hyphens as the same name', () => {
    expect(nameLikeness('Release Notes', 'release-notes')).toBe('same_name');
  });

  it('finds a name inside a longer one and a small typo', () => {
    expect(nameLikeness('release-notes', 'release-notes-v2')).toBe('similar_name');
    expect(nameLikeness('changelog', 'changelogs')).toBe('similar_name');
    expect(nameLikeness('secuirty', 'security')).toBe('similar_name');
  });

  it('leaves short and unrelated names alone', () => {
    expect(nameLikeness('qa', 'qa-bot')).toBeNull();
    expect(nameLikeness('scout', 'scribe')).toBeNull();
    expect(nameLikeness('', 'scout')).toBeNull();
  });
});

describe('how alike two descriptions are', () => {
  it('needs several shared words that carry meaning', () => {
    expect(
      descriptionsAlike(
        'Write release notes from merged pull requests',
        'Draft the release notes from the merged pull requests of a milestone',
      ),
    ).toBe(true);
    expect(descriptionsAlike('Write release notes', 'Review security findings')).toBe(false);
    expect(descriptionsAlike('Use this skill with that user', 'Use this with each user')).toBe(
      false,
    );
  });
});

describe('similarTo', () => {
  const candidates: CrewCandidate[] = [
    { kind: 'skill', name: 'triage', spark: 'Scout', description: 'Sort new tickets by urgency' },
    {
      kind: 'skill',
      name: 'notes',
      spark: 'Scribe',
      description: 'Write release notes from merged pull requests',
    },
    { kind: 'skill', name: 'release-notes', spark: 'Scout', description: 'Notes for a release' },
  ];

  it('lists the same name first, then similar names, then similar descriptions', () => {
    const found = similarTo(
      { name: 'release-notes', description: 'Write release notes from merged pull requests' },
      candidates,
    );
    expect(found).toEqual([
      { kind: 'skill', name: 'release-notes', spark: 'Scout', reason: 'same_name' },
      { kind: 'skill', name: 'notes', spark: 'Scribe', reason: 'similar_name' },
    ]);
    expect(
      similarTo(
        { name: 'changes', description: 'Release notes written from merged pull requests' },
        candidates,
      ),
    ).toEqual([{ kind: 'skill', name: 'notes', spark: 'Scribe', reason: 'similar_description' }]);
  });

  it('finds nothing for something new', () => {
    expect(similarTo({ name: 'deploy', description: 'Roll out a build' }, candidates)).toEqual([]);
  });
});
