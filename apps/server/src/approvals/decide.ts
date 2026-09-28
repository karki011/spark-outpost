import path from 'node:path';
import type {
  ApprovalKind,
  ApprovalOption,
  FileDiff,
  InvolvementLevel,
} from '@spark-outpost/contracts';
import { isSecretPath, refusalFor, relativeInside } from '../projects/path-policy.ts';
import {
  allowlistCovers,
  commandWords,
  deletedPaths,
  isGitForcePush,
  isGitPush,
  normalizeCommand,
  resolveCommandPath,
} from './commands.ts';
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
export const OUTSIDE_DELETE_REASON = 'Deleting outside the repo always asks';
export const OUTSIDE_WRITE_REASON = 'Changing files outside the repo always asks';
export const SECRET_REASON = 'Secret files always ask';
export const INSTALL_REASON = 'Installing packages always asks';
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

function touchesSecret(request: ApprovalRequest): boolean {
  if (request.paths.some((target) => isSecretTarget(request.roots, target))) return true;
  if (!request.command) return false;
  const cwd = commandCwd(request);
  return commandWords(request.command)
    .filter((word) => word !== '' && !word.startsWith('-'))
    .some((word) => {
      if (isSecretPath(path.basename(word))) return true;
      return isSecretTarget(request.roots, resolveCommandPath(word, cwd, request.home));
    });
}

function outsideRoots(request: ApprovalRequest, target: string): boolean {
  return place(request.roots, target).relative === null;
}

export function alwaysAskReason(request: ApprovalRequest): string | null {
  if (request.command) {
    const cwd = commandCwd(request);
    const deleted = deletedPaths(request.command).map((word) =>
      resolveCommandPath(word, cwd, request.home),
    );
    if (deleted.some((target) => outsideRoots(request, target))) return OUTSIDE_DELETE_REASON;
  }
  if (request.toolKind === 'delete' && request.paths.some((p) => outsideRoots(request, p))) {
    return OUTSIDE_DELETE_REASON;
  }
  if (touchesSecret(request)) return SECRET_REASON;
  if (request.command && isPackageInstall(request.command)) return INSTALL_REASON;
  const writes = request.kind === 'edit' || request.toolKind === 'move';
  if (writes && request.paths.some((target) => outsideRoots(request, target))) {
    return OUTSIDE_WRITE_REASON;
  }
  return null;
}

function refusal(request: ApprovalRequest): string | null {
  if (request.command && isGitForcePush(request.command)) return FORCE_PUSH_REASON;
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

export function decide(
  level: InvolvementLevel,
  request: ApprovalRequest,
  runRules: readonly RunRule[],
  allowlist: readonly string[],
): Decision {
  const refused = refusal(request);
  if (refused) return { verdict: 'reject', reason: refused };
  const always = alwaysAskReason(request);
  if (always) return { verdict: 'ask', reason: always };
  if (runRules.some((rule) => matchesRule(request, rule))) {
    return { verdict: 'allow', by: 'run_rule' };
  }
  if (request.kind === 'other' && request.title === ENTER_PLAN_MODE_TITLE) {
    return { verdict: 'allow', by: 'level', why: ENTER_PLAN_MODE_WHY };
  }
  if (level === 'full-auto') return { verdict: 'allow', by: 'level' };
  if (request.kind === 'edit') {
    return level === 'hands-off' ? { verdict: 'allow', by: 'level' } : ASK;
  }
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
    return listed ? { verdict: 'allow', by: 'allowlist' } : ASK;
  }
  return ASK;
}
