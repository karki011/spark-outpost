import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseChangelog,
  releaseDate,
  renderIndex,
  renderReadmeSection,
  renderVersionPage,
  replaceReadmeSection,
  syncVersionBadge,
} from './release-downloads-render.ts';

const root = path.resolve(import.meta.dirname, '..');
const releasesDir = path.join(root, 'releases');
const VERSION_PAGE = /^\d+\.\d+\.\d+(-[\w.]+)?\.md$/;
const readmePath = path.join(root, 'README.md');

function readIfExists(file: string): string | undefined {
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function expectedFiles(): Map<string, string> {
  const changelog = readFileSync(path.join(root, 'apps/desktop/CHANGELOG.md'), 'utf8');
  const releases = parseChangelog(changelog);
  const latest = releases[0];
  if (!latest) throw new Error('apps/desktop/CHANGELOG.md lists no version');
  const files = new Map<string, string>();
  const dates = new Map<string, string | undefined>();
  for (const release of releases) {
    const pagePath = path.join(releasesDir, `${release.version}.md`);
    const existing = readIfExists(pagePath);
    const date = existing === undefined ? today() : releaseDate(existing);
    dates.set(release.version, date);
    files.set(pagePath, renderVersionPage(release, date));
  }
  files.set(path.join(releasesDir, 'README.md'), renderIndex(releases, dates));
  files.set(
    readmePath,
    syncVersionBadge(
      replaceReadmeSection(readFileSync(readmePath, 'utf8'), renderReadmeSection(latest)),
      latest.version,
    ),
  );
  return files;
}

function staleVersionPages(expected: Map<string, string>): string[] {
  if (!existsSync(releasesDir)) return [];
  return readdirSync(releasesDir)
    .filter((name) => VERSION_PAGE.test(name))
    .map((name) => path.join(releasesDir, name))
    .filter((file) => !expected.has(file));
}

function main(): void {
  const check = process.argv.includes('--check');
  const expected = expectedFiles();
  const stale = [...expected]
    .filter(([file, content]) => readIfExists(file) !== content)
    .map(([file]) => file);
  const extra = staleVersionPages(expected);
  if (check) {
    const problems = [...stale, ...extra].map((file) => path.relative(root, file));
    if (problems.length > 0) {
      console.error(
        `Download links are out of date with apps/desktop/CHANGELOG.md: ${problems.join(', ')}`,
      );
      console.error('Run pnpm release:downloads and commit the result.');
      process.exitCode = 1;
    }
    return;
  }
  mkdirSync(releasesDir, { recursive: true });
  for (const file of stale) writeFileSync(file, expected.get(file) ?? '');
  for (const file of extra) rmSync(file);
  console.log(`Updated ${stale.length + extra.length} file(s).`);
}

main();
