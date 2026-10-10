import type { ApprovalKind, ApprovalOption, FileDiff, ModePosture } from '@spark-outpost/contracts';
import { protectedPath, refusalFor } from '../projects/path-policy.ts';
import { commandTree, treeWords } from './command-tree.ts';
import { allowlistCovers, normalizeCommand, resolveCommandPath } from './commands.ts';
import {
  forcePush,
  isGitPush,
  publishesBesidesPush,
  publishesCode,
  skipsPushHooks,
  setsGitConfig,
  type ForcePush,
} from './git-commands.ts';
import { ENTER_PLAN_MODE_TITLE, ENTER_PLAN_MODE_WHY } from '../plans/plan-mode.ts';
import { pieceRefusal, type PieceGuard } from './piece-guard.ts';
import { NO_FILES, type FileLister } from './file-lister.ts';
import { ASK_RUN_REASON, askRunRefusal } from './ask-run.ts';
import {
  publishVerdict,
  type PublishBasis,
  type PublishContext,
  type PublishVerdict,
} from './publish-policy.ts';
import { stackedPushRefusal } from './stacked-push.ts';
import type { OwnRepo } from './own-repo.ts';
import type { SecretSend } from './secret-send.ts';
import { secretSendReason, sentOut, type SentOut } from './taint.ts';
import { writeTargets } from './write-targets.ts';
import { commandCwd, isSecretTarget, outsideRoots, place, placedLabel } from './request-place.ts';
import { alwaysAsk, type RailAsk } from './rails.ts';
import type { ShellScript } from './shell-parse.ts';
import { withResolvedVariables } from './shell-variables.ts';
import { onlyReads, partRequests, shellView, type ShellView } from './shell-view.ts';

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
  agentReason?: string | null;
}

export type RunRule =
  { kind: 'execute'; command: string } | { kind: 'edit' } | { kind: 'other'; title: string };

export type Decision =
  | { verdict: 'allow'; by: 'level' | 'run_rule' | 'allowlist'; why?: string; sent?: SentOut }
  | { verdict: 'reject'; reason: string }
  | {
      verdict: 'ask';
      reason: string | null;
      forcePush?: string[];
      instructionFiles?: string[];
      gitControl?: string[];
      because?: string;
      observed?: string[];
      sendsTo?: string;
      secretSend?: string[];
      secretFiles?: string[];
    };

export const FS_WRITE_TOOL_KIND = 'write_text_file';

export const PUSH_REASON = 'Pushing publishes outside this computer';
export const PUSH_HOOKS_REASON =
  "Pushes never skip this repository's hooks. Read what the hook reports and fix it, or tell the user what it needs";
export const BUILDER_PUBLISH_REASON =
  "Builders don't push, open pull requests or change remotes: Spark Outpost commits, pushes and opens the PR when the task is done";
export { OUTSIDE_DELETE_REASON, OUTSIDE_WRITE_REASON, SECRET_REASON } from './rails.ts';
export const SAFE_READ_WHY = 'a read-only command inside the project';
export const ASK_AUTO_WHY = 'Automatic in an Ask turn';
export const ASK_TURN_ASKS =
  'Spark asks before commands in a question turn, unless they only read files';

export const INSTRUCTION_REASON =
  'Agent instruction files (AGENTS.md, CLAUDE.md, .claude, .cursor/rules, .spark) always ask';
export const GIT_CONTROL_REASON =
  'Git runs hooks and settings from .git outside Spark on every commit, so changing them always asks';
export const PIECE_PROTECTED_REASON =
  "Pieces don't change agent instructions, git hooks or git config mid-story unless the piece owns that exact file";

export function forcePushReason(branches: readonly string[]): string {
  return `This rewrites history on ${branches.join(', ')} on the remote`;
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

export function guardedTargets(asked: ApprovalRequest): Guarded {
  const request = withResolvedVariables(asked);
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

export interface DecideOptions {
  builder?: boolean;
  piece?: PieceGuard;
  files?: FileLister;
  askRun?: boolean;
  askAutoWhy?: string | null;
  defaultBranch?: string | null;
  observed?: readonly string[];
  own?: OwnRepo | null;
  secretSend?: SecretSend;
  instructionGrants?: ReadonlySet<string>;
  shell?: ShellScript | null;
  agentAsks?: boolean;
  publish?: PublishContext;
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

function noted(decision: Decision, sent: SentOut | null): Decision {
  if (!sent || decision.verdict === 'reject') return decision;
  if (decision.verdict === 'allow') return { ...decision, sent };
  return { ...decision, observed: sent.observed, sendsTo: sent.target };
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

function askRunChange(request: ApprovalRequest, view: ShellView | null): string | null {
  const cwd = commandCwd(request);
  const parts = view ? [request, ...partRequests(request, view)] : [request];
  for (const part of parts) {
    const reason = askRunRefusal(part, cwd, request.home);
    if (reason) return reason;
  }
  const writes = (view?.redirects ?? []).some((kind) => kind.startsWith('writes_'));
  return writes ? ASK_RUN_REASON : null;
}

function refusal(
  request: ApprovalRequest,
  options: DecideOptions,
  forced: ForcePush | null,
  guarded: Guarded,
  view: ShellView | null,
  published: PublishVerdict | null,
): string | null {
  if (options.builder && request.command && publishesCode(request.command)) {
    if (published?.kind === 'refuse') return published.reason;
    if (!published && !soloLeasePush(request.command, options, forced)) {
      return BUILDER_PUBLISH_REASON;
    }
  }
  const stacked = request.command
    ? stackedPushRefusal(request.command, options.publish?.task ?? null)
    : null;
  if (stacked) return stacked;
  if (request.command && skipsPushHooks(request.command)) return PUSH_HOOKS_REASON;
  const asking = options.askRun ? askRunChange(request, view) : null;
  if (asking) return asking;
  if (forced?.kind === 'refuse') return forced.reason;
  if (pieceProtected(guarded, options)) return PIECE_PROTECTED_REASON;
  const piece = options.piece ? pieceRefusal(request, options.piece) : null;
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

export const UNREADABLE_REASON =
  "Spark couldn't check that this command only reads, and this run only reads";

function unreadable(request: ApprovalRequest, view: ShellView | null): boolean {
  if (view) return view.unparsed;
  return request.command !== null && commandTree(request.command).opaque;
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
  asked: ApprovalRequest,
  runRules: RunRules,
  allowlist: readonly string[],
  options: DecideOptions = {},
): Decision {
  const request = withResolvedVariables(asked);
  const forced = request.command ? forcePush(request.command, options.defaultBranch ?? null) : null;
  const guarded = guardedTargets(request);
  const view = shellView(request, options.shell ?? null);
  const published = publishing(posture, request, options);
  const refused = refusal(request, options, forced, guarded, view, published);
  if (refused) return { verdict: 'reject', reason: refused };
  if (runRules.reject.some((rule) => matchesRule(asked, rule))) {
    return { verdict: 'reject', reason: RUN_REJECTED_REASON };
  }
  const found = options.secretSend?.kind === 'found' ? options.secretSend.files : null;
  if (forced?.kind === 'ask') {
    return {
      verdict: 'ask',
      reason: forcePushReason(forced.branches),
      forcePush: forced.branches,
      ...(found ? { secretSend: found } : {}),
    };
  }
  if (guarded.gitControl.length > 0) {
    return { verdict: 'ask', reason: GIT_CONTROL_REASON, gitControl: guarded.gitControl };
  }
  const grants = options.instructionGrants ?? new Set<string>();
  const ungranted = guarded.instructions.filter((relative) => !grants.has(relative));
  if (ungranted.length > 0) {
    return { verdict: 'ask', reason: INSTRUCTION_REASON, instructionFiles: guarded.instructions };
  }
  if (found) return { verdict: 'ask', reason: secretSendReason(found), secretSend: found };
  const files = options.files ?? NO_FILES;
  const weighed: Weighing = { posture, asked, request, view, published, files };
  return noted(byMode(weighed, runRules, allowlist, options), sentOut(request, files, options));
}

interface Weighing {
  posture: ModePosture;
  asked: ApprovalRequest;
  request: ApprovalRequest;
  view: ShellView | null;
  published: PublishVerdict | null;
  files: FileLister;
}

function byMode(
  { posture, asked, request, view, published, files }: Weighing,
  runRules: RunRules,
  allowlist: readonly string[],
  options: DecideOptions,
): Decision {
  const always = alwaysAsk(request, files, view);
  if (always) return railAsked(request, always);
  if (runRules.allow.some((rule) => matchesRule(asked, rule))) {
    return { verdict: 'allow', by: 'run_rule' };
  }
  if (published?.kind === 'allow') return publishAllowed(published.basis);
  if (request.kind === 'other' && request.title === ENTER_PLAN_MODE_TITLE) {
    return { verdict: 'allow', by: 'level', why: ENTER_PLAN_MODE_WHY };
  }
  if (options.agentAsks && posture !== 'full_access' && request.kind !== 'other') {
    return agentAsked(request, view, allowlist, options);
  }
  const pushes = request.command !== null && isGitPush(request.command);
  if (modeAllows(posture, request)) return { verdict: 'allow', by: 'level' };
  if (request.kind === 'edit') return unapproved(posture);
  if (request.kind === 'execute') {
    if (request.command && pushes) {
      const listed = allowlistCovers(allowlist, asked.command ?? request.command);
      return listed
        ? { verdict: 'allow', by: 'allowlist' }
        : { verdict: 'ask', reason: PUSH_REASON };
    }
    if (onlyReads(request, view)) {
      return { verdict: 'allow', by: 'level', why: SAFE_READ_WHY };
    }
    if (options.askRun && unreadable(request, view)) {
      return { verdict: 'ask', reason: UNREADABLE_REASON };
    }
    const listed = asked.command !== null && allowlistCovers(allowlist, asked.command);
    if (listed) return { verdict: 'allow', by: 'allowlist' };
    if (options.askRun && options.askAutoWhy) {
      return { verdict: 'allow', by: 'level', why: options.askAutoWhy };
    }
    if (options.askRun) return { verdict: 'ask', reason: null, because: ASK_TURN_ASKS };
    return unapproved(posture);
  }
  return unapproved(posture);
}

function railAsked(request: ApprovalRequest, asked: RailAsk): Decision {
  if (asked.rail !== 'secret') return { verdict: 'ask', reason: asked.reason };
  const secretFiles = asked.paths.map((target) => placedLabel(request.roots, request.home, target));
  return { verdict: 'ask', reason: asked.reason, secretFiles: [...new Set(secretFiles)] };
}

function agentAsked(
  request: ApprovalRequest,
  view: ShellView | null,
  allowlist: readonly string[],
  options: DecideOptions,
): Decision {
  if (request.kind !== 'execute' || !request.command) return ASK;
  if (onlyReads(request, view)) {
    return { verdict: 'allow', by: 'level', why: SAFE_READ_WHY };
  }
  if (options.askRun && options.askAutoWhy && !unreadable(request, view)) {
    return { verdict: 'allow', by: 'level', why: options.askAutoWhy };
  }
  return allowlistCovers(allowlist, request.command) ? { verdict: 'allow', by: 'allowlist' } : ASK;
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
export const PUBLISH_FOLLOW_UP_WHY = "a fix for this chat's open pull request";

function publishAllowed(basis: PublishBasis): Decision {
  if (basis === 'requested') return { verdict: 'allow', by: 'level', why: PUBLISH_ASKED_WHY };
  if (basis === 'full_auto') return { verdict: 'allow', by: 'level', why: PUBLISH_FULL_AUTO_WHY };
  if (basis === 'follow_up') return { verdict: 'allow', by: 'level', why: PUBLISH_FOLLOW_UP_WHY };
  return { verdict: 'allow', by: 'level' };
}

function unapproved(posture: ModePosture): Decision {
  return posture === 'denies' ? { verdict: 'reject', reason: DENIES_REASON } : ASK;
}
