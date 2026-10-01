import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { guideHrefTarget, loadGuidePages, type GuidePage } from '@spark-outpost/contracts';

const GUIDE = path.resolve(import.meta.dirname, '../../../../docs/guide');
const WEB_SRC = path.resolve(import.meta.dirname, '..');

function readGuide(): GuidePage[] {
  const files: Record<string, string> = {};
  for (const name of readdirSync(GUIDE).filter((entry) => entry.endsWith('.md'))) {
    files[name] = readFileSync(path.join(GUIDE, name), 'utf8');
  }
  return loadGuidePages(files);
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [full] : [];
  });
}

const pages = readGuide();
const bySlug = new Map(pages.map((page) => [page.slug, page]));

function hasTarget(slug: string, anchor: string | null): boolean {
  const page = bySlug.get(slug);
  if (!page) return false;
  return anchor === null || page.headings.some((heading) => heading.anchor === anchor);
}

describe('the user guide', () => {
  it('parses every page with unique titles and no body title', () => {
    expect(pages.length).toBeGreaterThan(10);
    expect(new Set(pages.map((page) => page.title)).size).toBe(pages.length);
    for (const page of pages) {
      expect(
        page.headings.filter((heading) => heading.depth === 1),
        page.slug,
      ).toEqual([]);
    }
  });

  it('links only to pages and headings that exist', () => {
    for (const page of pages) {
      for (const match of page.body.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const target = guideHrefTarget(match[1]!);
        if (!target) continue;
        expect(
          hasTarget(target.slug || page.slug, target.anchor),
          `${page.slug}: ${match[1]}`,
        ).toBe(true);
      }
    }
  });

  it('chains the Get started pages in order with a closing Next link', () => {
    const steps = pages.filter((page) => page.section === 'Get started' && !page.comingSoon);
    expect(steps.length).toBeGreaterThanOrEqual(5);
    steps.slice(0, -1).forEach((page, index) => {
      const next = steps[index + 1]!;
      expect(page.body.trimEnd(), page.slug).toMatch(
        new RegExp(`\\*\\*Next:\\*\\* \\[${next.title}\\]\\(${next.slug}\\.md\\)$`),
      );
    });
  });

  it('has a light and a dark file for every screenshot a page shows', () => {
    for (const page of pages) {
      for (const match of page.body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const light = path.join(GUIDE, match[1]!);
        expect(existsSync(light), `${page.slug}: ${match[1]}`).toBe(true);
        expect(existsSync(light.replace(/-light\.png$/, '-dark.png')), match[1]).toBe(true);
      }
    }
  });

  it('only sends doc links from the app to pages and headings that exist', () => {
    const targets = sourceFiles(WEB_SRC).flatMap((file) =>
      [
        ...readFileSync(file, 'utf8').matchAll(
          /doc=\{\{\s*page: '([^']+)'(?:, heading: '([^']+)')?/g,
        ),
      ].map((match) => ({ file: path.basename(file), page: match[1]!, heading: match[2] ?? null })),
    );
    expect(targets.length).toBeGreaterThanOrEqual(5);
    for (const target of targets) {
      expect(hasTarget(target.page, target.heading), JSON.stringify(target)).toBe(true);
    }
  });
});
