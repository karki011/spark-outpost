export const REMOVAL_RULE =
  'For each deleted file, function, export, test, guard (auth, permission, validation) or large block, check that the request asked for it or the Builder\'s reply explains it. If neither does, add "[removed] Removed `X` from `path` — why?". [removed] findings never make the verdict concerns.';

const REMOVED_LINE = /^\W*\[removed\]\s*/i;

export function isRemovalFinding(finding: string): boolean {
  return REMOVED_LINE.test(finding);
}

export function removalText(finding: string): string {
  return finding.replace(REMOVED_LINE, '').trim();
}

export function splitRemovals(findings: readonly string[]): {
  removed: string[];
  rest: string[];
} {
  return {
    removed: findings.filter(isRemovalFinding).map(removalText),
    rest: findings.filter((finding) => !isRemovalFinding(finding)),
  };
}
