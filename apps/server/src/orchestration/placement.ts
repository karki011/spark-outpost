import type { NoulVerdict } from './parallel-choice.ts';
import { isResearchStep } from './parallel.ts';
import { dependsOn, stepFiles } from './step-files.ts';

export interface LaneOptions {
  split?: 'jev' | 'large' | 'any';
  placement?: 'jev' | 'shared' | 'worktree';
}

export type LanePlacement = 'shared' | 'worktree';

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
const GENERATED =
  /(?:^|\/)(?:dist|build|out|generated|__generated__|coverage|\.next)\/|\.(?:gen|generated)\.[^/]+$|\.d\.ts$|\.min\.(?:js|css)$/i;

export function sharedTreeBlocker(file: string): string | null {
  if (MANIFEST.test(file)) return 'a manifest';
  if (LOCKFILE.test(file)) return 'a lockfile';
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

export type WorktreeNeed =
  'overlapping files' | 'sensitive files' | 'destructive work' | 'unattended Codex' | 'requested';

export interface PlacementContext {
  destructive: boolean;
  unattendedCodex: boolean;
}

export const PLAIN_CONTEXT: PlacementContext = { destructive: false, unattendedCodex: false };

const DESTRUCTIVE_STEP =
  /\b(?:drop|truncate|migrat(?:e|es|ing|ion)|delete\s+(?:the\s+|all\s+|old\s+)*(?:files?|folders?|director(?:y|ies)|data|rows?|records?|tables?|columns?)|rm\s+-rf|rewrite\s+(?:the\s+)?history|force[- ]push)\b/i;

function destructiveLanes(
  steps: readonly string[],
  lanes: readonly (readonly number[])[],
  context: PlacementContext,
): boolean {
  if (context.destructive) return true;
  return lanes.flat().some((index) => DESTRUCTIVE_STEP.test(steps[index] ?? ''));
}

interface Need {
  need: WorktreeNeed;
  reason: string;
}

function safetyNeed(
  steps: readonly string[],
  lanes: readonly (readonly number[])[],
  context: PlacementContext,
): Need | null {
  const blocked = hardBlock(steps, lanes);
  if (blocked) return { need: 'overlapping files', reason: blocked };
  if (context.unattendedCodex) {
    return { need: 'unattended Codex', reason: 'Codex Builders work unattended at this level' };
  }
  if (destructiveLanes(steps, lanes, context)) {
    return { need: 'destructive work', reason: 'a lane deletes, migrates or rewrites data' };
  }
  return null;
}

export interface PlacementChoice {
  placement: LanePlacement;
  reason: string;
  need: WorktreeNeed | null;
}

const SEPARATE = 'lanes change separate source files';

export function rulePlacement(
  steps: readonly string[],
  lanes: readonly (readonly number[])[],
  context: PlacementContext = PLAIN_CONTEXT,
): PlacementChoice {
  const safety = safetyNeed(steps, lanes, context);
  if (safety) return { placement: 'worktree', ...safety };
  const sensitive = sensitiveFiles(steps, lanes)[0];
  if (sensitive) {
    const reason = `${sensitive.file} is ${sensitive.kind}`;
    return { placement: 'worktree', reason, need: 'sensitive files' };
  }
  return { placement: 'shared', reason: SEPARATE, need: null };
}

export interface JevPlacement {
  answered: boolean;
  verdict: NoulVerdict | null;
}

function sensitiveReason(jev: JevPlacement): string {
  if (!jev.answered || !jev.verdict) return 'Jev did not answer';
  return jev.verdict.value === false ? 'Jev expects conflicts' : 'Jev is unsure';
}

export function choosePlacement(
  steps: readonly string[],
  lanes: readonly (readonly number[])[],
  jev: JevPlacement,
  option: LaneOptions['placement'] = 'jev',
  context: PlacementContext = PLAIN_CONTEXT,
): PlacementDecision {
  const rule = rulePlacement(steps, lanes, context);
  const decided = (
    choice: PlacementChoice,
    source: PlacementDecision['source'],
  ): PlacementDecision => ({ ...choice, rule, jev: jev.verdict, source });
  const safety = safetyNeed(steps, lanes, context);
  if (safety) return decided({ placement: 'worktree', ...safety }, 'rules');
  if (option === 'shared') {
    return decided(
      { placement: 'shared', reason: 'the shared tree was requested', need: null },
      'forced',
    );
  }
  if (option === 'worktree') {
    return decided(
      { placement: 'worktree', reason: 'worktrees were requested', need: 'requested' },
      'forced',
    );
  }
  const sensitive = sensitiveFiles(steps, lanes)[0];
  if (!sensitive) return decided({ placement: 'shared', reason: SEPARATE, need: null }, 'rules');
  if (jev.verdict?.value === true) {
    const reason = `Jev is sure the Builders can share the folder despite ${sensitive.file}`;
    return decided({ placement: 'shared', reason, need: null }, 'jev');
  }
  const reason = `${sensitive.file} is ${sensitive.kind} and ${sensitiveReason(jev)}`;
  return decided(
    { placement: 'worktree', reason, need: 'sensitive files' },
    jev.answered && jev.verdict ? 'jev' : 'rules',
  );
}
