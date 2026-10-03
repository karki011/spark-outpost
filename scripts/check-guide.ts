import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { redactValue } from '../apps/server/src/audit/redact.ts';
import { renderResult } from '../apps/server/src/spark-mcp/format.ts';
import { SPARK_TOOLS } from '../apps/server/src/spark-mcp/server.ts';
import { guideListing, readGuidePage } from '../apps/server/src/spark-mcp/tools/docs-tool.ts';
import { GUIDE_REDIRECTS } from '../packages/contracts/src/guide-redirects.ts';
import { loadGuidePages, type GuidePage } from '../packages/contracts/src/guide.ts';
import {
  checkCoverage,
  checkImages,
  checkPages,
  checkRedirects,
  proseWords,
  type GuideViolation,
} from './guide-rules.ts';

const GUIDE = path.resolve(import.meta.dirname, '../docs/guide');
const SETTINGS_DIALOG = path.resolve(
  import.meta.dirname,
  '../apps/web/src/settings/SettingsDialog.tsx',
);

function readPages(): GuidePage[] {
  const files: Record<string, string> = {};
  for (const name of readdirSync(GUIDE).filter((entry) => entry.endsWith('.md'))) {
    files[name] = readFileSync(path.join(GUIDE, name), 'utf8');
  }
  return loadGuidePages(files);
}

function settingsSections(): string[] {
  const source = readFileSync(SETTINGS_DIALOG, 'utf8');
  const list = source.slice(source.indexOf('const SECTIONS'), source.indexOf('];'));
  return [...list.matchAll(/label: '([^']+)'/g)].map((match) => `**${match[1]}**`);
}

function fitsSparkDocs(page: string, value: unknown): GuideViolation[] {
  if (renderResult(value) === JSON.stringify(redactValue(value))) return [];
  return [{ page, message: 'spark_docs would clip this; shorten or split it' }];
}

function checkSparkDocs(pages: readonly GuidePage[]): GuideViolation[] {
  return [
    ...fitsSparkDocs('page list', { sections: guideListing(pages) }),
    ...pages.flatMap((page) =>
      fitsSparkDocs(page.slug, readGuidePage({ page, anchor: null, movedFrom: null })),
    ),
  ];
}

function violationsFor(pages: readonly GuidePage[]): GuideViolation[] {
  const bySlug = new Map(pages.map((page) => [page.slug, page]));
  const toolNames = SPARK_TOOLS.map((tool) => `\`${tool.name}\``);
  return [
    ...checkPages(pages),
    ...checkImages(pages, readdirSync(path.join(GUIDE, 'images'))),
    ...checkRedirects(pages, GUIDE_REDIRECTS),
    ...checkCoverage(bySlug.get('spark-tools'), 'spark-tools', 'Spark tool', toolNames),
    ...checkCoverage(bySlug.get('settings'), 'settings', 'Settings section', settingsSections()),
    ...checkSparkDocs(pages),
  ];
}

function main(): void {
  let pages: GuidePage[];
  try {
    pages = readPages();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  const violations = violationsFor(pages);
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`docs/guide ${violation.page}: ${violation.message}`);
    }
    console.error(`\n${violations.length} guide rule violation(s). See docs/guide/README.md.`);
    process.exit(1);
  }
  const words = pages.reduce((sum, page) => sum + proseWords(page.body), 0);
  console.log(`Guide rules passed for ${pages.length} pages, ${words} words.`);
}

main();
