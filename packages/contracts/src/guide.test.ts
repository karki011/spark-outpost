import { describe, expect, it } from 'vitest';
import {
  groupGuideSections,
  guideHrefTarget,
  guideLink,
  headingAnchor,
  loadGuidePages,
  parseGuideLink,
  parseGuidePage,
  uniqueAnchors,
} from './guide.ts';

const PAGE = `---
title: "Approvals & protected paths"
section: Safety
order: 310
summary: What Spark asks before it acts.
---

Intro text.

## Approval cards

\`\`\`sh
# not a heading
\`\`\`

### Hold to confirm: git hooks

## Approval cards
`;

describe('parseGuidePage', () => {
  it('reads the frontmatter, strips quotes and coerces the order', () => {
    const page = parseGuidePage('approvals', PAGE);
    expect(page).toMatchObject({
      slug: 'approvals',
      title: 'Approvals & protected paths',
      section: 'Safety',
      order: 310,
      summary: 'What Spark asks before it acts.',
      comingSoon: false,
    });
    expect(page.body.startsWith('Intro text.')).toBe(true);
  });

  it('lists headings outside code fences with unique anchors', () => {
    expect(parseGuidePage('approvals', PAGE).headings).toEqual([
      { depth: 2, text: 'Approval cards', anchor: 'approval-cards' },
      { depth: 3, text: 'Hold to confirm: git hooks', anchor: 'hold-to-confirm-git-hooks' },
      { depth: 2, text: 'Approval cards', anchor: 'approval-cards-1' },
    ]);
  });

  it('flags stub pages that say Coming soon', () => {
    const stub = PAGE.replace('Intro text.', '> **Coming soon.** This page is planned.');
    expect(parseGuidePage('approvals', stub).comingSoon).toBe(true);
  });

  it('rejects a page without frontmatter or with a missing field', () => {
    expect(() => parseGuidePage('bare', '# Title')).toThrow(/no frontmatter/);
    expect(() => parseGuidePage('half', '---\ntitle: Half\n---\nBody')).toThrow(
      /section, order, summary/,
    );
  });
});

describe('headingAnchor', () => {
  it('matches GitHub-style anchors', () => {
    expect(headingAnchor('Ship & pull requests')).toBe('ship--pull-requests');
    expect(headingAnchor('Use `.sparkignore` files')).toBe('use-sparkignore-files');
    expect(headingAnchor('Full auto → PR')).toBe('full-auto--pr');
    expect(headingAnchor('Step 1: Say hello')).toBe('step-1-say-hello');
  });

  it('numbers repeated anchors', () => {
    expect(uniqueAnchors(['Tips', 'Tips', 'Tips'])).toEqual(['tips', 'tips-1', 'tips-2']);
  });
});

describe('loading and grouping pages', () => {
  const page = (title: string, section: string, order: number) =>
    `---\ntitle: ${title}\nsection: ${section}\norder: ${order}\nsummary: s\n---\nBody`;

  it('skips the README, orders by order and groups sections by their first page', () => {
    const pages = loadGuidePages({
      '/docs/guide/README.md': page('Outline', 'X', 1),
      '/docs/guide/b.md': page('B', 'Second', 210),
      '/docs/guide/a.md': page('A', 'First', 110),
      '/docs/guide/c.md': page('C', 'First', 120),
    });
    expect(pages.map((entry) => entry.slug)).toEqual(['a', 'c', 'b']);
    expect(
      groupGuideSections(pages).map((entry) => [entry.section, entry.pages.map((p) => p.slug)]),
    ).toEqual([
      ['First', ['a', 'c']],
      ['Second', ['b']],
    ]);
  });
});

describe('guide links', () => {
  it('builds and parses deep links', () => {
    expect(guideLink('jev')).toBe('#/docs/jev');
    expect(guideLink('jev', 'what-it-costs')).toBe('#/docs/jev#what-it-costs');
    expect(parseGuideLink('#/docs/jev#what-it-costs')).toEqual({
      slug: 'jev',
      anchor: 'what-it-costs',
    });
    expect(parseGuideLink('#/docs')).toEqual({ slug: '', anchor: null });
    expect(parseGuideLink('#/docs/')).toEqual({ slug: '', anchor: null });
    expect(parseGuideLink('#/chats')).toBeNull();
    expect(parseGuideLink('')).toBeNull();
  });

  it('turns relative Markdown links into guide targets and leaves web links alone', () => {
    expect(guideHrefTarget('approvals.md#always-allow')).toEqual({
      slug: 'approvals',
      anchor: 'always-allow',
    });
    expect(guideHrefTarget('./jev.md')).toEqual({ slug: 'jev', anchor: null });
    expect(guideHrefTarget('#tips')).toEqual({ slug: '', anchor: 'tips' });
    expect(guideHrefTarget('https://example.com/a.md')).toBeNull();
    expect(guideHrefTarget('images/shot.png')).toBeNull();
    expect(guideHrefTarget('../README.md')).toBeNull();
  });
});
