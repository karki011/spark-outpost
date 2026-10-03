import path from 'node:path';
import type { ApprovalKind, ApprovalOption, FileDiff, ModePosture } from '@spark-outpost/contracts';
import {
  isSecretPath,
  protectedPath,
  refusalFor,
  relativeInside,
} from '../projects/path-policy.ts';
import { commandTree, deleteTargets, SHELLS, treeWords, type CommandTree } from './command-tree.ts';
import { allowlistCovers, normalizeCommand, programName, resolveCommandPath } from './commands.ts';
import {
  forcePush,
  isGitPush,
  publishesBesidesPush,
  publishesCode,
  setsGitConfig,
  type ForcePush,
} from './git-commands.ts';
import { ENTER_PLAN_MODE_TITLE, ENTER_PLAN_MODE_WHY } from '../plans/plan-mode.ts';
import { isPackageInstall, isSafeRead } from './command-kinds.ts';
import { pieceRefusal, type PieceGuard, type RelativeOf } from './piece-guard.ts';
import { diskLister, type FileLister } from './file-lister.ts';
import { readConcern } from './file-reads.ts';
import { askRunRefusal } from './ask-run.ts';
import { egressOf } from './egress.ts';
import { withoutHereText } from './inline-code.ts';
import { readArgs } from './read-args.ts';
import {
  publishVerdict,
  type PublishBasis,
  type PublishContext,
  type PublishVerdict,
} from './publish-policy.ts';
import { taintReason } from './taint.ts';
import { redirectTargets, writeTargets } from './write-targets.ts';

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
  mcpServer?: string | null;
}

export type RunRule =
  { kind: 'execute'; command: string } | { kind: 'edit' } | { kind: 'other'; title: string };

export type Decision =
  | { verdict: 'allow'; by: 'level' | 'run_rule' | 'allowlist'; why?: string }
  | { verdict: 'reject'; reason: string }
  | {
      verdict: 'ask';
      reason: string | null;
      forcePush?: string[];
      instructionFiles?: string[];
      gitControl?: string[];
      because?: string;
      observed?: string[];
    };

export const FS_WRITE_TOOL_KIND = 'write_text_file';

export const PUSH_REASON = 'Pushing publishes outside this computer';
export const BUILDER_PUBLISH_REASON =
  "Builders don't push, open pull requests or change remotes: Spark Outpost commits, pushes and opens the PR when the task is done";
export const OUTSIDE_DELETE_REASON = 'Deleting outside the repo always asks';
export const OUTSIDE_WRITE_REASON = 'Changing files outside the repo always asks';
export const SECRET_REASON = 'Secret files always ask';
export const INSTALL_REASON = 'Installing packages always asks';
export const NESTED_COMMAND_REASON = "Commands Spark can't see inside always ask";
export const UNKNOWN_READ_REASON = "Spark can't tell which files this reads";
export const HIDDEN_CODE_REASON = "Runs code Spark can't see";
export const SAFE_READ_WHY = 'a read-only command inside the project';
export const WORKTREE_AUTO_WHY = "Automatic in this chat's worktree";
export const ASK_AUTO_WHY = 'Automatic in an Ask turn';
export const ASK_TURN_ASKS =
  'Spark asks before commands in a question turn at Review each step, unless they only read files';

export const INSTRUCTION_REASON =
  'Agent instruction files (AGENTS.md, CLAUDE.md, .claude, .cursor/rules, .spark) always ask';
export const GIT_CONTROL_REASON =
  'Git runs hooks and settings from .git outside Spark on every commit, so changing them always asks';
export const PIECE_PROTECTED_REASON =
  "Pieces don't change agent instructions, git hooks or git config mid-story unless the piece owns that exact file";

export function forcePushReason(branches: readonly string[]): string {
  return `This rewrites history on ${branches.join(', ')} on the remote`;
}

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

interface Guarded {
  instructions: string[];
  gitControl: string[];
}

function writtenPaths(request: ApprovalRequest): string[] {
  if (request.kind === 'edit' || request.toolKind === 'move') return request.paths;
  if (!request.command) return [];
  return writeTargets(request.command, commandCwd(request), request.home) ?? [];
}

export function guardedTargets(request: ApprovalRequest): Guarded {
  const relatives = writtenPaths(request).flatMap((target) => {
    const { relative } = place(request.roots, target);
    return relative === null ? [] : [relative];
  });
  if (request.command && setsGitConfig(request.command)) relatives.push('.git/config');
  const unique = [...new Set(relatives)];
  return {
    instructions: unique.filter((relative) => protectedPath(relative) === 'instructions'),
    gitControl: unique.filter((relative) => protectedPath(relative) === 'git_control'),
  };
}

function commandReads(request: ApprovalRequest, tree: CommandTree | null, files: FileLister) {
  if (!request.command || !tree) return null;
  return readConcern(request.command, tree, {
    cwd: commandCwd(request),
    home: request.home,
    isSecret: (target) => isSecretTarget(request.roots, target),
    files,
  });
}

function runsHereText(program: readonly string[]): boolean {
  return SHELLS.has(programName(program)) || readArgs(program)?.stdinCode === true;
}

function hereTextWritesInside(request: ApprovalRequest, command: string): boolean {
  const clean = withoutHereText(command);
  if (clean === command) return false;
  const tree = commandTree(clean);
  if (tree.opaque || tree.commands.some(runsHereText)) return false;
  const redirects = [...redirectTargets(clean)].filter((word) => !word.startsWith('/dev/'));
  if (redirects.some((word) => /\$|`/.test(word))) return false;
  const cwd = commandCwd(request);
  const written = writeTargets(command, cwd, request.home);
  if (written === null) return false;
  const targets = [
    ...written,
    ...redirects.map((word) => resolveCommandPath(word, cwd, request.home)),
  ];
  return targets.every((target) => !outsideRoots(request, target));
}

function hidesCommands(request: ApprovalRequest, tree: CommandTree | null): boolean {
  if (!tree?.opaque || !request.command) return false;
  return !hereTextWritesInside(request, request.command);
}

function alwaysAskReason(request: ApprovalRequest, files: FileLister): string | null {
  const tree = request.command ? commandTree(request.command) : null;
  if (deletesOutside(request, tree)) return OUTSIDE_DELETE_REASON;
  if (touchesSecret(request, tree)) return SECRET_REASON;
  const reads = commandReads(request, tree, files);
  if (reads === 'secret') return SECRET_REASON;
  if (hidesCommands(request, tree)) return NESTED_COMMAND_REASON;
  if (reads === 'hidden') return HIDDEN_CODE_REASON;
  if (reads === 'unknown') return UNKNOWN_READ_REASON;
  if (request.command && isPackageInstall(request.command)) return INSTALL_REASON;
  const writes = request.kind === 'edit' || request.toolKind === 'move';
  if (writes && request.paths.some((target) => outsideRoots(request, target))) {
    return OUTSIDE_WRITE_REASON;
  }
  return null;
}

export interface DecideOptions {
  builder?: boolean;
  piece?: PieceGuard;
  files?: FileLister;
  askRun?: boolean;
  askAutoWhy?: string | null;
  worktreeAuto?: boolean;
  defaultBranch?: string | null;
  observed?: readonly string[];
  instructionGrants?: ReadonlySet<string>;
  publish?: PublishContext;
}

function secretLabel(roots: readonly RequestRoot[], target: string): string {
  return place(roots, target).relative ?? path.basename(target);
}

export function secretLabels(request: ApprovalRequest): string[] {
  const secret = (target: string) => isSecretTarget(request.roots, target);
  const cwd = commandCwd(request);
  const words = request.command ? treeWords(commandTree(request.command)) : [];
  const targets = [
    ...request.paths,
    ...words
      .filter((word) => word !== '' && !word.startsWith('-'))
      .map((word) => resolveCommandPath(word, cwd, request.home)),
  ].filter(secret);
  const labels = [...new Set(targets.map((target) => secretLabel(request.roots, target)))];
  return labels.length > 0 ? labels : ['a secret file'];
}

function taintedEgress(
  request: ApprovalRequest,
  options: DecideOptions,
  files: FileLister,
): Decision | null {
  const observed = options.observed ?? [];
  if (observed.length === 0) return null;
  const egress = egressOf(request, files);
  if (!egress) return null;
  return { verdict: 'ask', reason: taintReason(observed, egress), observed: [...observed] };
}

export function relativeTo(roots: readonly RequestRoot[]): RelativeOf {
  return (target) => place(roots, target).relative;
}

function soloLeasePush(command: string, options: DecideOptions, forced: ForcePush | null) {
  if (forced?.kind !== 'ask' || options.piece?.coordinated) return false;
  return !publishesBesidesPush(command);
}

function pieceProtected(guarded: Guarded, options: DecideOptions): boolean {
  const owned = options.piece?.owned;
  if (!owned) return false;
  return [...guarded.instructions, ...guarded.gitControl].some(
    (relative) => !owned.paths.includes(relative),
  );
}

function refusal(
  request: ApprovalRequest,
  options: DecideOptions,
  forced: ForcePush | null,
  guarded: Guarded,
  published: PublishVerdict | null,
): string | null {
  if (options.builder && request.command && publishesCode(request.command)) {
    if (published?.kind === 'refuse') return published.reason;
    if (!published && !soloLeasePush(request.command, options, forced)) {
      return BUILDER_PUBLISH_REASON;
    }
  }
  const asking = options.askRun ? askRunRefusal(request, commandCwd(request), request.home) : null;
  if (asking) return asking;
  if (forced?.kind === 'refuse') return forced.reason;
  if (pieceProtected(guarded, options)) return PIECE_PROTECTED_REASON;
  const piece = options.piece
    ? pieceRefusal(request, options.piece, relativeTo(request.roots))
    : null;
  if (piece) return piece;
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
  const forced = request.command ? forcePush(request.command, options.defaultBranch ?? null) : null;
  const guarded = guardedTargets(request);
  const published = publishing(posture, request, options);
  const refused = refusal(request, options, forced, guarded, published);
  if (refused) return { verdict: 'reject', reason: refused };
  if (runRules.reject.some((rule) => matchesRule(request, rule))) {
    return { verdict: 'reject', reason: RUN_REJECTED_REASON };
  }
  if (forced?.kind === 'ask') {
    return { verdict: 'ask', reason: forcePushReason(forced.branches), forcePush: forced.branches };
  }
  if (guarded.gitControl.length > 0) {
    return { verdict: 'ask', reason: GIT_CONTROL_REASON, gitControl: guarded.gitControl };
  }
  const grants = options.instructionGrants ?? new Set<string>();
  const ungranted = guarded.instructions.filter((relative) => !grants.has(relative));
  if (ungranted.length > 0) {
    return { verdict: 'ask', reason: INSTRUCTION_REASON, instructionFiles: guarded.instructions };
  }
  const files = options.files ?? diskLister;
  const tainted = taintedEgress(request, options, files);
  if (tainted) return tainted;
  const always = alwaysAskReason(request, files);
  if (always) return { verdict: 'ask', reason: always };
  if (runRules.allow.some((rule) => matchesRule(request, rule))) {
    return { verdict: 'allow', by: 'run_rule' };
  }
  if (published?.kind === 'allow') return publishAllowed(published.basis);
  if (request.kind === 'other' && request.title === ENTER_PLAN_MODE_TITLE) {
    return { verdict: 'allow', by: 'level', why: ENTER_PLAN_MODE_WHY };
  }
  const pushes = request.command !== null && isGitPush(request.command);
  if (options.worktreeAuto && !pushes) {
    return { verdict: 'allow', by: 'level', why: WORKTREE_AUTO_WHY };
  }
  if (modeAllows(posture, request)) return { verdict: 'allow', by: 'level' };
  if (request.kind === 'edit') return unapproved(posture);
  if (request.kind === 'execute') {
    if (request.command && pushes) {
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
    if (options.askRun && options.askAutoWhy) {
      return { verdict: 'allow', by: 'level', why: options.askAutoWhy };
    }
    if (options.askRun) return { verdict: 'ask', reason: null, because: ASK_TURN_ASKS };
    return unapproved(posture);
  }
  return unapproved(posture);
}

function publishing(
  posture: ModePosture,
  request: ApprovalRequest,
  options: DecideOptions,
): PublishVerdict | null {
  if (!request.command || !options.publish || options.piece?.coordinated) return null;
  return publishVerdict(request.command, posture, options.publish);
}

export const PUBLISH_ASKED_WHY = 'you asked to push or open a PR';
export const PUBLISH_FULL_AUTO_WHY = 'Full auto → PR';

function publishAllowed(basis: PublishBasis): Decision {
  if (basis === 'requested') return { verdict: 'allow', by: 'level', why: PUBLISH_ASKED_WHY };
  if (basis === 'full_auto') return { verdict: 'allow', by: 'level', why: PUBLISH_FULL_AUTO_WHY };
  return { verdict: 'allow', by: 'level' };
}

function unapproved(posture: ModePosture): Decision {
  return posture === 'denies' ? { verdict: 'reject', reason: DENIES_REASON } : ASK;
}
