import path from 'node:path';
import { ALLOWED_REASONS } from '@spark-outpost/contracts';
import type {
  ApprovalKind,
  ApprovalOption,
  FileDiff,
  ModePosture,
  SparkRuleRefusal,
} from '@spark-outpost/contracts';
import { refusalFor, type GitDirs } from '../projects/path-policy.ts';
import { commandTree } from './command-tree.ts';
import { allowlistCovers, normalizeCommand } from './commands.ts';
import { forcePush, isGitPush, skipsPushHooks, type ForcePush } from './git-commands.ts';
import { guardedTargets, heldGuards } from './guarded-targets.ts';
export { secretLabels } from './guarded-targets.ts';
import { ENTER_PLAN_MODE_TITLE, ENTER_PLAN_MODE_WHY } from '../plans/plan-mode.ts';
import { NO_FILES, type FileLister } from './file-lister.ts';
import { ASK_RUN_REASON, askRunRefusal } from './ask-run.ts';
import type { SparkRuleContext } from './gh-rules.ts';
import {
  askedForRule,
  followsAtOnce,
  sparkRuleAsk,
  sparkRuleRefusal,
} from './gh-rule-decisions.ts';
import { modeAllows } from './mode-allows.ts';
import { ownAgentStop, publishAllowed, publishing } from './decide-publish.ts';
import { floorDenial, heldForce, holds, railsWith, rulesOf } from './floor-rules.ts';
import {
  adoptedForceReason,
  ruled,
  type PublishContext,
  type PublishStop,
  type PublishVerdict,
  type TaskBranch,
} from './publish-policy.ts';
import { stackedPushRefusal } from './stacked-push.ts';
import type { OwnRepo } from './own-repo.ts';
import type { SecretSend } from './secret-send.ts';
import { secretSendReason, sentOut, type SentOut } from './taint.ts';
import { webAddressRefusal } from './web-address.ts';
import {
  BROWSER_DATA_REASON,
  browserDataDir,
  SPARK_RULES_REASON,
  touchesBrowserData,
  touchesSparkRules,
} from './browser-data.ts';
import { commandCwd, outsideRoots, place, placedLabel } from './request-place.ts';
import { alwaysAsk, type RailFound } from './rails.ts';
import type { ShellScript } from './shell-parse.ts';
import { withResolvedVariables } from './shell-variables.ts';
import { isFloorRuleId, type FloorRuleId } from '../spark-rules/rule-ids.ts';
import { onlyReads, partRequests, shellView, type ShellView } from './shell-view.ts';

export interface RequestRoot {
  path: string;
  ignore: readonly string[];
  gitDirs?: GitDirs | null;
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
  address?: string | null;
  mode?: string | null;
  mcpServer?: string | null;
  agentReason?: string | null;
  subagent?: string | null;
  attachedFiles?: readonly string[];
}

export type RunRule =
  { kind: 'execute'; command: string } | { kind: 'edit' } | { kind: 'other'; title: string };

export type Decision =
  | { verdict: 'allow'; by: 'level' | 'run_rule' | 'allowlist'; why?: string; sent?: SentOut }
  | { verdict: 'reject'; reason: string; sparkRule?: SparkRuleRefusal; rule?: string }
  | {
      verdict: 'ask';
      reason: string | null;
      rule?: string;
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
export {
  CHAT_PUBLISH_REASON,
  PUBLISH_ASKED_WHY,
  PUBLISH_FOLLOW_UP_WHY,
  PUBLISH_FULL_AUTO_WHY,
} from './decide-publish.ts';
export { OUTSIDE_DELETE_REASON, OUTSIDE_WRITE_REASON, SECRET_REASON } from './rails.ts';
export const SAFE_READ_WHY = ALLOWED_REASONS.safeRead;
export const ASK_AUTO_WHY = ALLOWED_REASONS.askAuto;
export const ASK_TURN_ASKS =
  'Spark asks before commands in a question turn, unless they only read files';

export const INSTRUCTION_REASON =
  'Agent instruction files (AGENTS.md, CLAUDE.md, .agents, .claude, .codex, .cursor/rules, .spark) always ask';
export const GIT_CONTROL_REASON =
  'Git runs hooks and settings from .git outside Spark on every commit, so changing them always asks';

export function forcePushReason(branches: readonly string[]): string {
  return `This rewrites history on ${branches.join(', ')} on the remote`;
}

export interface DecideOptions {
  changesProject?: boolean;
  files?: FileLister;
  askRun?: boolean;
  askAutoWhy?: string | null;
  planningWhy?: string | null;
  defaultBranch?: string | null;
  observed?: readonly string[];
  own?: OwnRepo | null;
  secretSend?: SecretSend;
  instructionGrants?: ReadonlySet<string>;
  shell?: ShellScript | null;
  agentAsks?: boolean;
  publish?: PublishContext;
  sparkRules?: SparkRuleContext;
  browserData?: string | null;
}

function asRule(rule: string | null | undefined): FloorRuleId | null {
  return rule && isFloorRuleId(rule) ? rule : null;
}

function noted(decision: Decision, sent: SentOut | null): Decision {
  if (!sent || decision.verdict === 'reject') return decision;
  if (decision.verdict === 'allow') return { ...decision, sent };
  return { ...decision, observed: sent.observed, sendsTo: sent.target };
}

function adoptedForce(forced: ForcePush | null, task: TaskBranch | null): ForcePush | null {
  if (forced?.kind !== 'ask' || !task?.adopted || !forced.branches.includes(task.branch)) {
    return forced;
  }
  return { kind: 'refuse', reason: adoptedForceReason(task.branch, task.adopted) };
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

function planningRuns(
  request: ApprovalRequest,
  view: ShellView | null,
  options: DecideOptions,
): Decision | null {
  if (!options.planningWhy || request.kind !== 'execute' || !request.command) return null;
  if (unreadable(request, view) || askRunChange(request, view)) return null;
  return { verdict: 'allow', by: 'level', why: options.planningWhy };
}

type Stopped = Pick<PublishStop, 'kind' | 'reason'> & { rule?: string | null };

function refused(reason: string | null): Stopped | null {
  return reason ? { kind: 'refuse', reason } : null;
}

function refusal(
  request: ApprovalRequest,
  options: DecideOptions,
  forced: ForcePush | null,
  view: ShellView | null,
  published: PublishVerdict | null,
): Stopped | null {
  const address = request.address ? webAddressRefusal(request.address) : null;
  if (address) return refused(address);
  const ownAgent = ownAgentStop(request, options, forced, published);
  if (ownAgent?.kind === 'refuse') return ownAgent;
  return refused(fixedRefusal(request, options, forced, view)) ?? ownAgent;
}

function readsOutside(request: ApprovalRequest, target: string): boolean {
  if (!outsideRoots(request, target)) return false;
  return !(request.attachedFiles ?? []).includes(path.resolve(target));
}

function fixedRefusal(
  request: ApprovalRequest,
  options: DecideOptions,
  forced: ForcePush | null,
  view: ShellView | null,
): string | null {
  const stacked = request.command
    ? stackedPushRefusal(request.command, options.publish?.task ?? null)
    : null;
  if (stacked) return stacked;
  if (request.command && skipsPushHooks(request.command)) return PUSH_HOOKS_REASON;
  const asking = options.askRun ? askRunChange(request, view) : null;
  if (asking) return asking;
  if (forced?.kind === 'refuse') return forced.reason;
  if (request.toolKind === 'read' && request.paths.some((p) => readsOutside(request, p))) {
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

export interface RuledDecision {
  decision: Decision;
  rule: string | null;
}

export function decideRuled(...args: Parameters<typeof ruledDecide>): RuledDecision {
  const decided = ruledDecide(...args);
  if (decided.verdict === 'allow' || !decided.rule) return { decision: decided, rule: null };
  const { rule, ...decision } = decided;
  return { decision, rule };
}

export function decide(...args: Parameters<typeof ruledDecide>): Decision {
  return decideRuled(...args).decision;
}

function ruledDecide(
  posture: ModePosture,
  asked: ApprovalRequest,
  runRules: RunRules,
  allowlist: readonly string[],
  options: DecideOptions = {},
): Decision {
  const request = withResolvedVariables(asked);
  const browserData = options.browserData === undefined ? browserDataDir() : options.browserData;
  if (touchesBrowserData(request, browserData)) {
    return { verdict: 'reject', reason: BROWSER_DATA_REASON };
  }
  if (touchesSparkRules(request)) {
    return { verdict: 'reject', reason: SPARK_RULES_REASON };
  }
  const forced = heldForce(
    adoptedForce(
      request.command ? forcePush(request.command, options.defaultBranch ?? null) : null,
      options.publish?.task ?? null,
    ),
    rulesOf(options.sparkRules),
  );
  const rules = rulesOf(options.sparkRules);
  const guarded = heldGuards(guardedTargets(request), rules);
  const view = shellView(request, options.shell ?? null);
  const ghRefused = sparkRuleRefusal(request, options);
  if (ghRefused) return ghRefused;
  const published = publishing(posture, request, options);
  const stopped = refusal(request, options, forced, view, published);
  if (stopped?.kind === 'refuse') {
    return { verdict: 'reject', reason: stopped.reason, ...ruled(asRule(stopped.rule)) };
  }
  if (runRules.reject.some((rule) => matchesRule(asked, rule))) {
    return { verdict: 'reject', reason: RUN_REJECTED_REASON };
  }
  if (stopped) return { verdict: 'ask', reason: stopped.reason, ...ruled(asRule(stopped.rule)) };
  const ghAsked = sparkRuleAsk(request, options);
  if (ghAsked) return ghAsked;
  const sending = options.secretSend?.kind === 'found' ? options.secretSend.files : null;
  const found = sending && holds(rules, 'SecretSend') ? sending : null;
  const denied = floorDenial(
    {
      forcePush: forced?.kind === 'ask' ? forced.branches : null,
      gitControl: guarded.gitControl,
      instructions: guarded.instructions,
      secretSend: found,
    },
    rules,
    {
      forcePush: forcePushReason,
      gitControl: GIT_CONTROL_REASON,
      instructions: INSTRUCTION_REASON,
      secretSend: secretSendReason,
    },
  );
  if (denied) return denied;
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
  const rules = rulesOf(options.sparkRules);
  const railDenied = alwaysAsk(request, files, view, railsWith(rules, 'deny'));
  if (railDenied) return { verdict: 'reject', reason: railDenied.reason, rule: railDenied.rule };
  const always = alwaysAsk(request, files, view, railsWith(rules, 'ask'));
  if (always) return railAsked(request, always);
  if (runRules.allow.some((rule) => matchesRule(asked, rule))) {
    return { verdict: 'allow', by: 'run_rule' };
  }
  if (published?.kind === 'allow' && !askedForRule(posture, request, options)) {
    return publishAllowed(published.basis, published.rerequest === true);
  }
  if (followsAtOnce(posture, request, options)) return { verdict: 'allow', by: 'level' };
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
    const planning = planningRuns(request, view, options);
    if (planning) return planning;
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

function railAsked(request: ApprovalRequest, asked: RailFound): Decision {
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
  const planning = planningRuns(request, view, options);
  if (planning) return planning;
  return allowlistCovers(allowlist, request.command) ? { verdict: 'allow', by: 'allowlist' } : ASK;
}

function unapproved(posture: ModePosture): Decision {
  return posture === 'denies' ? { verdict: 'reject', reason: DENIES_REASON } : ASK;
}
