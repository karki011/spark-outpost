import { ESCALATE_AT } from '../advisor/policy.ts';
import { ESCALATED_KINDS } from './escalation.ts';
import { isLargeDiff, type DiffFile } from './risk-rules.ts';
import type { MemberRoute } from './routing.ts';

const ONE_LINER_LINES = 10;
const FEATURE_FILES = 3;

export const TEST_FILE =
  /(?:^|\/)(?:tests?|__tests__|specs?|e2e)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.(?:go|py|rb)$|(?:^|\/)test_[^/]+\.py$/;
const NOT_SOURCE =
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock)$|(?:^|\/)(?:dist|build|generated|__generated__)\/|\.min\.(?:js|css)$|\.snap$|\.(?:md|mdx|txt|rst)$/i;
const PACKAGE_DIRS = new Set(['apps', 'packages', 'services', 'libs', 'crates', 'modules']);

export function sourceFiles(files: readonly DiffFile[]): DiffFile[] {
  return files.filter((file) => !TEST_FILE.test(file.path) && !NOT_SOURCE.test(file.path));
}

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

export function escalatedHighStakes(route: MemberRoute | undefined): boolean {
  const kind = route?.escalation?.kind;
  const stakes = route?.score?.signals.stakes.value ?? 0;
  return kind !== undefined && ESCALATED_KINDS.has(kind) && stakes >= ESCALATE_AT;
}

export function wantsCritic(
  files: readonly DiffFile[],
  planned: boolean,
  highStakes = false,
): boolean {
  if (isLargeDiff(files)) return true;
  if (files.length === 0) return false;
  if (highStakes) return true;
  if (isOneLiner(files)) return false;
  if (planned) return true;
  const source = sourceFiles(files);
  if (source.length >= FEATURE_FILES) return true;
  return new Set(source.map((file) => areaOf(file.path))).size >= 2;
}
