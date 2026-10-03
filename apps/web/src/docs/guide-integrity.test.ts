import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGuidePages, type GuidePage } from '@spark-outpost/contracts';

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

describe('doc links from the app', () => {
  it('open the landing page first', () => {
    expect(pages[0]).toMatchObject({ slug: 'welcome', type: 'start' });
  });

  it('point at pages and headings that exist, without leaning on a redirect', () => {
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
