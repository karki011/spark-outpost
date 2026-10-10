import type { InvolvementLevel, ModePosture } from '@spark-outpost/contracts';
import { programName } from './commands.ts';
import {
  gitPublishesBesidesPush,
  hostingCommands,
  hostingRead,
  publishesCode,
  publishesThroughGit,
  pushTargets,
  reachesHosting,
  type PushTarget,
} from './git-commands.ts';

export interface FollowUpRound {
  workspaceId: string;
  conversationId: string;
}

export interface PublishGrant {
  level: InvolvementLevel | null;
  requested: boolean;
  followUp?: FollowUpRound | null;
}

export interface TaskBranch {
  branch: string;
  protectedBranches: readonly string[];
  pull?: number | null;
}

export interface PublishContext {
  grant: PublishGrant;
  task: TaskBranch | null;
}

export type PublishBasis = 'requested' | 'full_auto' | 'follow_up' | 'mode';

export interface PublishBrief {
  basis: PublishBasis;
  branch: string;
}

export type PublishVerdict =
  { kind: 'allow'; basis: PublishBasis } | { kind: 'refuse'; reason: string };

export const NO_TASK_BRANCH_REASON =
  "Only this chat's own spark/ branch can be pushed, and this run isn't on one";
export const REMOTE_RAIL_REASON =
  'Changing git remotes, mailing patches and hosting CLIs other than gh stay refused';

export function ghRailReason(subcommand: string): string {
  return `${subcommand} is refused: only gh pr create and gh pr edit on this chat's own pull request are allowed, and reading any pull request, check, run or gh api GET is fine`;
}
export const REMOTE_URL_REASON = 'Push to a named remote such as origin, not a URL';
export const WIDE_PUSH_REASON = 'Pushes that delete, prune, mirror or push every ref are refused';

export function otherBranchReason(branch: string): string {
  return `Only this chat's own branch can be pushed, named explicitly: git push origin ${branch}`;
}

const PERFORMING_POSTURES: ReadonlySet<ModePosture> = new Set(['auto', 'full_access']);

export function publishBasis(posture: ModePosture, grant: PublishGrant): PublishBasis | null {
  if (grant.requested) return 'requested';
  if (grant.level === 'full-auto') return 'full_auto';
  if (grant.followUp) return 'follow_up';
  if (PERFORMING_POSTURES.has(posture)) return 'mode';
  return null;
}

const PR_ASK =
  /\b(open|create|make|raise|submit|send|ship|put up)\b[^.?!\n]{0,40}\b(pr|prs|pull requests?)\b|\b(take|get|bring|carry|turn)\b[^.?!\n]{0,40}\b(to|into)\s+(an?\s+|the\s+)?(draft\s+)?(pr|pull request)\b/i;
const PUSH_ASK =
  /\b(push|publish)\s+(it|this|that|them|up|everything|the\s+(branch|changes?|commits?|code|work|fix))\b|\b(push|publish)\s+to\s+(origin|remote|github|gitlab)\b|\bgit push\b|^\s*(please\s+)?(push|publish)\s*[.!]?\s*$/i;
const DECLINED =
  /\b(don['’]?t|do not|never|no need to|without)\s+(push|publish|open|create|make|raise|submit|send|ship|put up)\b/i;

export function publishRequested(text: string): boolean {
  if (DECLINED.test(text)) return false;
  return PR_ASK.test(text) || PUSH_ASK.test(text);
}

export function withoutPublishAsks(text: string): string {
  const every = (pattern: RegExp) => new RegExp(pattern.source, 'gi');
  return text.replace(every(PR_ASK), ' ').replace(every(PUSH_ASK), ' ');
}

const GH_PR_WRITES = new Set(['create', 'edit']);
const PR_SELECTOR = /^(#?\d+|https?:\/\/.*)$/i;
const NAMES_REPO = /^(?:-R|--repo(?:=|$))/;

function flagName(token: string): string {
  return token.split('=')[0]!;
}

function flagValue(args: readonly string[], names: readonly string[]): string[] {
  return args.flatMap((token, index) => {
    if (!names.includes(flagName(token))) return [];
    const inline = token.indexOf('=');
    return [inline === -1 ? (args[index + 1] ?? '') : token.slice(inline + 1)];
  });
}

function positionals(args: readonly string[]): string[] {
  return args.filter((token, index) => {
    if (token.startsWith('-')) return false;
    const previous = args[index - 1];
    return !previous || !previous.startsWith('-') || previous.includes('=');
  });
}

function ownPullTarget(rest: readonly string[], task: TaskBranch): boolean {
  if (rest.some((token) => NAMES_REPO.test(token))) return false;
  const own = (token: string) =>
    token === task.branch || (Boolean(task.pull) && token.replace(/^#/, '') === String(task.pull));
  if (flagValue(rest, ['-H', '--head']).some((head) => head !== task.branch)) return false;
  if (rest.some((token) => PR_SELECTOR.test(token) && !own(token))) return false;
  return positionals(rest).every(own);
}

function ghSubcommand(args: readonly string[]): string {
  const named = args[0] === 'api' ? args.slice(0, 1) : args.slice(0, 2);
  return ['gh', ...named.filter((word) => !word.startsWith('-'))].join(' ');
}

function ghRefusal(args: readonly string[], task: TaskBranch): string | null {
  const [group, verb, ...rest] = args;
  const allowed = group === 'pr' && verb !== undefined && GH_PR_WRITES.has(verb);
  return allowed && ownPullTarget(rest, task) ? null : ghRailReason(ghSubcommand(args));
}

type Program = readonly string[];

function writesHosting(program: Program): boolean {
  return !hostingRead(program);
}

function opensPull(program: Program): boolean {
  const [, group, verb] = program;
  return programName(program) === 'gh' && group === 'pr' && GH_PR_WRITES.has(verb ?? '');
}

function hostingRefusal(
  command: string,
  task: TaskBranch,
  judged: (program: Program) => boolean,
): string | null {
  for (const program of hostingCommands(command)) {
    if (!judged(program)) continue;
    const refused =
      programName(program) === 'gh' ? ghRefusal(program.slice(1), task) : REMOTE_RAIL_REASON;
    if (refused) return refused;
  }
  return null;
}

function viewsOwnPull(command: string, task: TaskBranch | null): boolean {
  if (!task) return false;
  return hostingCommands(command).every(([, group, verb, ...rest]) => {
    return group === 'pr' && verb === 'view' && ownPullTarget(rest, task);
  });
}

function pushRefusal(push: PushTarget, task: TaskBranch): string | null {
  if (push.widens) return WIDE_PUSH_REASON;
  if (push.remote && /[:/@]/.test(push.remote)) return REMOTE_URL_REASON;
  const named = push.branches.length > 0 && push.branches.every((name) => name === task.branch);
  if (!named || task.protectedBranches.includes(task.branch)) {
    return otherBranchReason(task.branch);
  }
  return null;
}

export function otherBranchPushes(command: string, task: TaskBranch | null): string[] | null {
  const own = task && !task.protectedBranches.includes(task.branch) ? task.branch : null;
  const pushes = pushTargets(command);
  const named = pushes
    .flatMap((push) => push.branches)
    .filter((name): name is string => name !== null && name !== own);
  if (named.length > 0) return [...new Set(named)];
  return own === null && pushes.length > 0 ? [] : null;
}

function refusalAmong(
  command: string,
  task: TaskBranch | null,
  judged: (program: Program) => boolean,
): string | null {
  if (gitPublishesBesidesPush(command)) return REMOTE_RAIL_REASON;
  if (!task) return NO_TASK_BRANCH_REASON;
  const hosting = hostingRefusal(command, task, judged);
  if (hosting) return hosting;
  for (const push of pushTargets(command)) {
    const refused = pushRefusal(push, task);
    if (refused) return refused;
  }
  return null;
}

export function publishRefusal(command: string, task: TaskBranch | null): string | null {
  return refusalAmong(command, task, writesHosting);
}

export function publishesBranch(command: string): boolean {
  return publishesThroughGit(command) || hostingCommands(command).some(opensPull);
}

export function branchRefusal(command: string, task: TaskBranch | null): string | null {
  return refusalAmong(command, task, opensPull);
}

export function publishVerdict(
  command: string,
  posture: ModePosture,
  context: PublishContext,
): PublishVerdict | null {
  if (!reachesHosting(command)) return null;
  const basis = publishBasis(posture, context.grant);
  if (!basis) return null;
  if (!publishesCode(command)) {
    return viewsOwnPull(command, context.task) ? { kind: 'allow', basis } : null;
  }
  const refused = publishRefusal(command, context.task);
  return refused ? { kind: 'refuse', reason: refused } : { kind: 'allow', basis };
}
