import path from 'node:path';
import type { ApprovalKind, ApprovalOption, FileDiff, ModePosture } from '@spark-outpost/contracts';
import { isSecretPath, refusalFor, relativeInside } from '../projects/path-policy.ts';
import { commandTree, deleteTargets, treeWords, type CommandTree } from './command-tree.ts';
import { allowlistCovers, normalizeCommand, resolveCommandPath } from './commands.ts';
import { isGitForcePush, isGitPush, publishesCode } from './git-commands.ts';
import { ENTER_PLAN_MODE_TITLE, ENTER_PLAN_MODE_WHY } from '../plans/plan-mode.ts';
import { isPackageInstall, isSafeRead } from './command-kinds.ts';

export interface RequestRoot {
  path: string;
  ignore: readonly string[];
}

export interface ApprovalRequest {
  toolCallId: string;
  rpcId: string | null;
  kind: ApprovalKind;
  toolKind: string | null;
  title: string;
  command: string | null;
  cwd: string | null;
  paths: string[];
  diffs: FileDiff[];
  options: ApprovalOption[];
  roots: readonly RequestRoot[];
  home: string;
  plan?: string | null;
  mode?: string | null;
}

export type RunRule =
  { kind: 'execute'; command: string } | { kind: 'edit' } | { kind: 'other'; title: string };

export type Decision =
  | { verdict: 'allow'; by: 'level' | 'run_rule' | 'allowlist'; why?: string }
  | { verdict: 'reject'; reason: string }
  | { verdict: 'ask'; reason: string | null };

export const FS_WRITE_TOOL_KIND = 'write_text_file';

export const PUSH_REASON = 'Pushing publishes outside this computer';
export const FORCE_PUSH_REASON = 'Force pushes are refused';
export const BUILDER_PUBLISH_REASON =
  "Builders don't push, open pull requests or change remotes: Spark Outpost commits, pushes and opens the PR when the task is done";
export const OUTSIDE_DELETE_REASON = 'Deleting outside the repo always asks';
export const OUTSIDE_WRITE_REASON = 'Changing files outside the repo always asks';
export const SECRET_REASON = 'Secret files always ask';
export const INSTALL_REASON = 'Installing packages always asks';
export const NESTED_COMMAND_REASON = "Commands Spark can't see inside always ask";
export const SAFE_READ_WHY = 'a read-only command inside the project';

interface Placement {
  relative: string | null;
  root: RequestRoot | null;
}

function place(roots: readonly RequestRoot[], target: string): Placement {
  let best: Placement = { relative: null, root: null };
  for (const root of roots) {
    const relative = relativeInside(root.path, target);
    if (relative === null) continue;
    if (!best.root || root.path.length > best.root.path.length) best = { relative, root };
  }
  return best;
}

function isSecretTarget(roots: readonly RequestRoot[], target: string): boolean {
  const { relative, root } = place(roots, target);
  if (relative !== null && root) return isSecretPath(relative, root.ignore);
  return isSecretPath(path.basename(target));
}

function commandCwd(request: ApprovalRequest): string {
  return request.cwd ?? request.roots[0]?.path ?? request.home;
}

function touchesSecret(request: ApprovalRequest, tree: CommandTree | null): boolean {
  if (request.paths.some((target) => isSecretTarget(request.roots, target))) return true;
  if (!tree) return false;
  const cwd = commandCwd(request);
  return treeWords(tree)
    .filter((word) => word !== '' && !word.startsWith('-'))
    .some((word) => {
      if (isSecretPath(path.basename(word))) return true;
      return isSecretTarget(request.roots, resolveCommandPath(word, cwd, request.home));
    });
}

function outsideRoots(request: ApprovalRequest, target: string): boolean {
  return place(request.roots, target).relative === null;
}

function deletesOutside(request: ApprovalRequest, tree: CommandTree | null): boolean {
  if (request.toolKind === 'delete' && request.paths.some((p) => outsideRoots(request, p))) {
    return true;
  }
  if (!tree) return false;
  const targets = deleteTargets(tree, commandCwd(request), request.home);
  return targets === null || targets.some((target) => outsideRoots(request, target));
}

function alwaysAskReason(request: ApprovalRequest): string | null {
  const tree = request.command ? commandTree(request.command) : null;
  if (deletesOutside(request, tree)) return OUTSIDE_DELETE_REASON;
  if (touchesSecret(request, tree)) return SECRET_REASON;
  if (tree?.opaque) return NESTED_COMMAND_REASON;
  if (request.command && isPackageInstall(request.command)) return INSTALL_REASON;
  const writes = request.kind === 'edit' || request.toolKind === 'move';
  if (writes && request.paths.some((target) => outsideRoots(request, target))) {
    return OUTSIDE_WRITE_REASON;
  }
  return null;
}

export interface DecideOptions {
  builder?: boolean;
}

function refusal(request: ApprovalRequest, options: DecideOptions): string | null {
  if (request.command && isGitForcePush(request.command)) return FORCE_PUSH_REASON;
  if (options.builder && request.command && publishesCode(request.command)) {
    return BUILDER_PUBLISH_REASON;
  }
  if (request.toolKind === 'read' && request.paths.some((p) => outsideRoots(request, p))) {
    return 'Reads outside the project are refused';
  }
  if (request.kind !== 'edit') return null;
  for (const target of request.paths) {
    const { relative, root } = place(request.roots, target);
    if (relative !== null && refusalFor(relative, 'write', root?.ignore ?? []) === 'inside .git') {
      return "Files inside .git can't be changed";
    }
  }
  return null;
}

export function ruleFor(request: ApprovalRequest): RunRule | null {
  if (request.kind === 'execute') {
    return request.command ? { kind: 'execute', command: normalizeCommand(request.command) } : null;
  }
  if (request.kind === 'edit') return { kind: 'edit' };
  return { kind: 'other', title: request.title };
}

function matchesRule(request: ApprovalRequest, rule: RunRule): boolean {
  if (rule.kind !== request.kind) return false;
  if (rule.kind === 'execute') {
    return request.command !== null && normalizeCommand(request.command) === rule.command;
  }
  if (rule.kind === 'other') return rule.title === request.title;
  return true;
}

const ASK: Decision = { verdict: 'ask', reason: null };

function isSafeReadRequest(request: ApprovalRequest): boolean {
  if (!request.command) return false;
  return isSafeRead(request.command, {
    cwd: commandCwd(request),
    home: request.home,
    inside: (target) =>
      request.roots.some((root) => root.path === target) || !outsideRoots(request, target),
  });
}

export const RUN_REJECTED_REASON = 'You chose to always reject this in this run';
export const DENIES_REASON = "The agent's mode skips anything that isn't pre-approved";

export interface RunRules {
  allow: readonly RunRule[];
  reject: readonly RunRule[];
}

export const NO_RUN_RULES: RunRules = { allow: [], reject: [] };

function modeAllows(posture: ModePosture, request: ApprovalRequest): boolean {
  if (posture === 'full_access' || posture === 'auto') return true;
  return posture === 'edits' && request.kind === 'edit';
}

export function decide(
  posture: ModePosture,
  request: ApprovalRequest,
  runRules: RunRules,
  allowlist: readonly string[],
  options: DecideOptions = {},
): Decision {
  const refused = refusal(request, options);
  if (refused) return { verdict: 'reject', reason: refused };
  if (runRules.reject.some((rule) => matchesRule(request, rule))) {
    return { verdict: 'reject', reason: RUN_REJECTED_REASON };
  }
  const always = alwaysAskReason(request);
  if (always) return { verdict: 'ask', reason: always };
  if (runRules.allow.some((rule) => matchesRule(request, rule))) {
    return { verdict: 'allow', by: 'run_rule' };
  }
  if (request.kind === 'other' && request.title === ENTER_PLAN_MODE_TITLE) {
    return { verdict: 'allow', by: 'level', why: ENTER_PLAN_MODE_WHY };
  }
  if (modeAllows(posture, request)) return { verdict: 'allow', by: 'level' };
  if (request.kind === 'edit') return unapproved(posture);
  if (request.kind === 'execute') {
    if (request.command && isGitPush(request.command)) {
      const listed = allowlistCovers(allowlist, request.command);
      return listed
        ? { verdict: 'allow', by: 'allowlist' }
        : { verdict: 'ask', reason: PUSH_REASON };
    }
    if (isSafeReadRequest(request)) {
      return { verdict: 'allow', by: 'level', why: SAFE_READ_WHY };
    }
    const listed = request.command !== null && allowlistCovers(allowlist, request.command);
    if (listed) return { verdict: 'allow', by: 'allowlist' };
    return unapproved(posture);
  }
  return unapproved(posture);
}

function unapproved(posture: ModePosture): Decision {
  return posture === 'denies' ? { verdict: 'reject', reason: DENIES_REASON } : ASK;
}
