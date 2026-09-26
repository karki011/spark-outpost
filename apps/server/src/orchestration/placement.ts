import type { NoulVerdict } from './parallel-choice.ts';
import { isResearchStep } from './parallel.ts';
import { dependsOn, stepFiles } from './step-files.ts';

export interface LaneOptions {
  split?: 'jev' | 'large' | 'any';
  placement?: 'jev' | 'shared' | 'worktree';
}

export type LanePlacement = 'shared' | 'worktree';

export interface PlacementChoice {
  placement: LanePlacement;
  reason: string;
}

export interface PlacementDecision extends PlacementChoice {
  rule: PlacementChoice;
  jev: NoulVerdict | null;
  source: 'jev' | 'rules' | 'forced';
}

export interface SensitiveFile {
  file: string;
  kind: string;
}

const MANIFEST =
  /(?:^|\/)(?:package\.json|pnpm-workspace\.yaml|Cargo\.toml|go\.mod|pyproject\.toml|setup\.(?:py|cfg)|requirements[^/]*\.txt|Pipfile|Gemfile|composer\.json|deno\.jsonc?)$/i;
const LOCKFILE =
  /(?:^|\/)(?:[^/]+\.lock|[^/]+-lock\.(?:json|ya?ml)|bun\.lockb|go\.sum|npm-shrinkwrap\.json)$/i;
const CONFIG =
  /(?:^|\/)(?:tsconfig[^/]*\.json|jsconfig\.json|[^/]+\.config\.[cm]?[jt]s|eslint\.config\.[^/]+|\.eslintrc[^/]*|\.prettierrc[^/]*|\.babelrc[^/]*|\.env[^/]*|\.npmrc|\.nvmrc|\.gitignore|Dockerfile|docker-compose[^/]*\.ya?ml|Makefile)$|(?:^|\/)\.github\//i;
const GENERATED =
  /(?:^|\/)(?:dist|build|out|generated|__generated__|coverage|\.next)\/|\.(?:gen|generated)\.[^/]+$|\.d\.ts$|\.min\.(?:js|css)$/i;

export function sharedTreeBlocker(file: string): string | null {
  if (MANIFEST.test(file)) return 'a manifest';
  if (LOCKFILE.test(file)) return 'a lockfile';
  if (CONFIG.test(file)) return 'a config file';
  if (GENERATED.test(file)) return 'a generated file';
  return null;
}

export function laneChanges(steps: readonly string[], lane: readonly number[]): string[] {
  return [...new Set(lane.flatMap((index) => stepFiles(steps[index] ?? '').changes))];
}

function lanesMeet(steps: readonly string[], a: readonly number[], b: readonly number[]): boolean {
  const files = (index: number) => stepFiles(steps[index] ?? '');
  return a.some((left) => b.some((right) => dependsOn(files(left), files(right))));
}

export function hardBlock(
  steps: readonly string[],
  lanes: readonly (readonly number[])[],
): string | null {
  if (lanes.length < 2) return 'fewer than two lanes';
  const members = lanes.flat();
  if (members.some((index) => isResearchStep(steps[index] ?? ''))) return 'a lane researches';
  const silent = members.find((index) => stepFiles(steps[index] ?? '').changes.length === 0);
  if (silent !== undefined) return `step ${silent + 1} does not list the files it changes`;
  for (let a = 0; a < lanes.length; a += 1) {
    for (let b = a + 1; b < lanes.length; b += 1) {
      if (lanesMeet(steps, lanes[a]!, lanes[b]!)) return 'two lanes touch the same file';
    }
  }
  return null;
}

export function sensitiveFiles(
  steps: readonly string[],
  lanes: readonly (readonly number[])[],
): SensitiveFile[] {
  return lanes.flatMap((lane) =>
    laneChanges(steps, lane).flatMap((file) => {
      const kind = sharedTreeBlocker(file);
      return kind ? [{ file, kind }] : [];
    }),
  );
}

export function rulePlacement(
  steps: readonly string[],
  lanes: readonly (readonly number[])[],
): PlacementChoice {
  const blocked = hardBlock(steps, lanes);
  if (blocked) return { placement: 'worktree', reason: blocked };
  const sensitive = sensitiveFiles(steps, lanes)[0];
  if (sensitive) return { placement: 'worktree', reason: `${sensitive.file} is ${sensitive.kind}` };
  return { placement: 'shared', reason: 'lanes change separate source files' };
}

export interface JevPlacement {
  answered: boolean;
  verdict: NoulVerdict | null;
}

export function choosePlacement(
  steps: readonly string[],
  lanes: readonly (readonly number[])[],
  jev: JevPlacement,
  option: LaneOptions['placement'] = 'jev',
): PlacementDecision {
  const rule = rulePlacement(steps, lanes);
  const blocked = hardBlock(steps, lanes);
  const decided = (
    placement: LanePlacement,
    reason: string,
    source: PlacementDecision['source'],
  ) => ({
    placement,
    reason,
    rule,
    jev: jev.verdict,
    source,
  });
  if (blocked) return decided('worktree', blocked, 'rules');
  if (option === 'shared' || option === 'worktree') {
    return decided(
      option,
      option === 'shared' ? 'the shared tree was requested' : 'worktrees were requested',
      'forced',
    );
  }
  if (!jev.answered) return decided(rule.placement, rule.reason, 'rules');
  if (jev.verdict?.value === true) {
    return decided('shared', 'Jev is sure the Builders can share the folder', 'jev');
  }
  const why = jev.verdict?.value === false ? 'Jev expects conflicts' : 'Jev is unsure';
  return decided('worktree', why, 'jev');
}
