import { isLargeDiff, type DiffFile } from './risk-rules.ts';

/** The most a change can be and still count as a one-liner: one file, this many lines. */
export const ONE_LINER_LINES = 10;
/** A feature this many source files wide gets a Critic even without an agreed plan. */
export const FEATURE_FILES = 3;

const TEST_FILE =
  /(?:^|\/)(?:tests?|__tests__|specs?|e2e)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.(?:go|py|rb)$|(?:^|\/)test_[^/]+\.py$/;
const NOT_SOURCE =
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock)$|(?:^|\/)(?:dist|build|generated|__generated__)\/|\.min\.(?:js|css)$|\.snap$|\.(?:md|mdx|txt|rst)$/i;
const PACKAGE_DIRS = new Set(['apps', 'packages', 'services', 'libs', 'crates', 'modules']);

function sourceFiles(files: readonly DiffFile[]): DiffFile[] {
  return files.filter((file) => !TEST_FILE.test(file.path) && !NOT_SOURCE.test(file.path));
}

/** The part of the repo a file belongs to: a workspace package, or its top-level folder. */
export function areaOf(filePath: string): string {
  const parts = filePath.split('/');
  if (parts.length === 1) return '.';
  if (PACKAGE_DIRS.has(parts[0]!) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0]!;
}

export function isOneLiner(files: readonly DiffFile[]): boolean {
  const counted = files.filter((file) => !NOT_SOURCE.test(file.path));
  const lines = counted.reduce((total, file) => total + file.additions + file.deletions, 0);
  return sourceFiles(files).length <= 1 && lines <= ONE_LINER_LINES;
}

/**
 * Whether the finished Builder diff gets a Critic review (besides destructive work and review
 * requests, which the flow decides up front). A large diff always does. Otherwise one-liners
 * never do; a build from an agreed plan does; so does a feature that spans several source files
 * or more than one layer of the repo (for example a migration plus the code, or two packages).
 */
export function wantsCritic(files: readonly DiffFile[], planned: boolean): boolean {
  if (isLargeDiff(files)) return true;
  if (files.length === 0 || isOneLiner(files)) return false;
  if (planned) return true;
  const source = sourceFiles(files);
  if (source.length >= FEATURE_FILES) return true;
  return new Set(source.map((file) => areaOf(file.path))).size >= 2;
}
