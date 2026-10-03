import path from 'node:path';
import { isPackageInstall } from '../approvals/command-kinds.ts';
import { inMigrationsFolder } from './placement.ts';

export const FULL_CHECKS_REASON = 'the coordinator runs the full checks after integration';
const DOCS_ONLY_CHECK = 'none — docs only';
const MIGRATION_ONLY_CHECK = 'none — migration; full checks run after landing';

const DOCS_FILE = /\.(?:md|mdx|markdown|txt|rst|adoc)$/i;
const SQL_FILE = /\.sql$/i;
const DOCS_NAME = /(?:^|\/)(?:README|CHANGELOG|CHANGES|LICENSE|NOTICE|AUTHORS|CONTRIBUTING)$/i;

const MUTATING_FLAG = /(?:^|\s)(?:--write|-w|--fix|-u|--update(?:-snapshots)?)(?=\s|$)/;
const WHOLE_PROJECT = /^(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:check|ci|verify|format|lint:fix)\s*$/;
const NARROWING_FLAG = /(?:^|\s)(?:--filter|-F|--project|--dir|-C|--workspace)[=\s]+\S+/;
const PATH_WORD = /(?:^|\s)[./\w@-]*(?:\/[\w.@-]+|\.[cm]?[jt]sx?|\.py|\.go|\.rs|\.rb)(?=\s|$)/;

const TEST_RUNNERS = new Set([
  'node',
  'npx',
  'pnpm',
  'npm',
  'yarn',
  'bun',
  'deno',
  'vitest',
  'jest',
  'tsc',
  'eslint',
  'playwright',
  'pytest',
  'python',
  'python3',
  'go',
  'cargo',
  'make',
  'mvn',
  'gradle',
  'dotnet',
  'bundle',
  'rspec',
  'phpunit',
  'swift',
]);

function program(command: string): string {
  return path.basename(command.split(' ')[0] ?? '');
}

function squash(command: string): string {
  return command.replace(/\s+/g, ' ').trim();
}

export function docsOnly(paths: readonly string[]): boolean {
  return paths.length > 0 && paths.every((file) => DOCS_FILE.test(file) || DOCS_NAME.test(file));
}

function migrationOnly(paths: readonly string[]): boolean {
  return paths.length > 0 && paths.every((file) => inMigrationsFolder(file) || SQL_FILE.test(file));
}

export function noCheckLabel(paths: readonly string[]): string {
  if (docsOnly(paths)) return DOCS_ONLY_CHECK;
  return migrationOnly(paths) ? MIGRATION_ONLY_CHECK : 'none';
}

export function runsWholeProject(command: string): boolean {
  return WHOLE_PROJECT.test(squash(command));
}

export function scopedCheckProblem(
  command: string,
  projectChecks: readonly string[],
): string | null {
  const text = squash(command);
  if (!text) return 'is empty';
  const runner = program(text);
  if (
    !TEST_RUNNERS.has(runner) &&
    !projectChecks.some((check) => program(squash(check)) === runner)
  ) {
    return `runs \`${runner}\`, which is not a test runner or one of the project's checks`;
  }
  if (isPackageInstall(text)) return `installs packages; ${FULL_CHECKS_REASON}`;
  if (MUTATING_FLAG.test(text)) return 'changes files; a scoped check only reads';
  if (WHOLE_PROJECT.test(text)) return `runs the whole project; ${FULL_CHECKS_REASON}`;
  if (projectChecks.some((check) => squash(check) === text)) {
    return `is a whole-project check; narrow it to the piece's files (${FULL_CHECKS_REASON})`;
  }
  if (!NARROWING_FLAG.test(text) && !PATH_WORD.test(text)) {
    return 'names no path or package to narrow it to the piece';
  }
  return null;
}
