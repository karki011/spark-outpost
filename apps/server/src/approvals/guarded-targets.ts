import { protectedPath } from '../projects/path-policy.ts';
import type { SparkRuleSet } from '../spark-rules/resolve.ts';
import { commandTree, treeWords } from './command-tree.ts';
import { resolveCommandPath } from './commands.ts';
import type { ApprovalRequest } from './decide.ts';
import { holds } from './floor-rules.ts';
import { gitConfigUses } from './git-commands.ts';
import { GLOBAL_GIT_CONFIG, REPO_GIT_CONFIG, SYSTEM_GIT_CONFIG } from './git-config.ts';
import { gitControlLabel } from './git-dirs.ts';
import { commandCwd, isSecretTarget, place, placedLabel } from './request-place.ts';
import { withResolvedVariables } from './shell-variables.ts';
import { writeTargets } from './write-targets.ts';

export interface Guarded {
  instructions: string[];
  gitControl: string[];
}

function writtenPaths(request: ApprovalRequest): string[] {
  if (request.kind === 'edit' || request.toolKind === 'move') return request.paths;
  if (!request.command) return [];
  return writeTargets(request.command, commandCwd(request), request.home) ?? [];
}

function configTargets(request: ApprovalRequest): { files: string[]; labels: string[] } {
  const writes = request.command ? gitConfigUses(request.command).filter((use) => use.writes) : [];
  const cwd = commandCwd(request);
  const places = new Set(writes.map((use) => use.where));
  return {
    files: writes.flatMap((use) =>
      use.file === null ? [] : [resolveCommandPath(use.file, cwd, request.home)],
    ),
    labels: [
      ...(places.has('repo') ? [REPO_GIT_CONFIG] : []),
      ...(places.has('global') ? [GLOBAL_GIT_CONFIG] : []),
      ...(places.has('system') ? [SYSTEM_GIT_CONFIG] : []),
    ],
  };
}

export function guardedTargets(asked: ApprovalRequest): Guarded {
  const request = withResolvedVariables(asked);
  const config = configTargets(request);
  const targets = [...writtenPaths(request), ...config.files];
  const relatives = targets.flatMap((target) => {
    const { relative } = place(request.roots, target);
    return relative === null ? [] : [relative];
  });
  const unique = [...new Set(relatives)];
  const control = unique.filter((relative) => protectedPath(relative) === 'git_control');
  const realGitDir = targets.flatMap((target) => gitControlLabel(request.roots, target) ?? []);
  return {
    instructions: unique.filter((relative) => protectedPath(relative) === 'instructions'),
    gitControl: [...new Set([...control, ...realGitDir, ...config.labels])],
  };
}

export function namedSecrets(
  request: ApprovalRequest,
  secret: (target: string) => boolean,
): string[] {
  const cwd = commandCwd(request);
  const words = request.command ? treeWords(commandTree(request.command)) : [];
  const targets = [
    ...request.paths,
    ...words
      .filter((word) => word !== '' && !word.startsWith('-'))
      .map((word) => resolveCommandPath(word, cwd, request.home)),
  ].filter(secret);
  return [...new Set(targets.map((target) => placedLabel(request.roots, request.home, target)))];
}

export const UNNAMED_SECRET = 'a secret file';

export function secretLabels(asked: ApprovalRequest): string[] {
  const request = withResolvedVariables(asked);
  const labels = namedSecrets(request, (target) => isSecretTarget(request.roots, target));
  return labels.length > 0 ? labels : [UNNAMED_SECRET];
}

export function heldGuards(guarded: Guarded, rules: SparkRuleSet): Guarded {
  return {
    instructions: holds(rules, 'InstructionFile(edit)') ? guarded.instructions : [],
    gitControl: holds(rules, 'GitConfig') ? guarded.gitControl : [],
  };
}

