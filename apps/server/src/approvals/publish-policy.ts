import type { InvolvementLevel, ModePosture } from '@spark-outpost/contracts';
import { commandTree } from './command-tree.ts';
import { programName } from './commands.ts';
import { withoutDataHeredocs } from './inline-code.ts';
import {
  HOSTING_CLIS,
  gitPublishesBesidesPush,
  publishesCode,
  pushTargets,
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
export const GH_RAIL_REASON =
  "Only gh pr create, gh pr view and gh pr edit for this chat's own pull request are allowed";
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

const GH_PR_VERBS = new Set(['create', 'view', 'edit']);
const PR_SELECTOR = /^(#?\d+|https?:\/\/.*)$/i;

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

function ghRefusal(args: readonly string[], task: TaskBranch): string | null {
  const [group, verb, ...rest] = args;
  if (group !== 'pr' || !verb || !GH_PR_VERBS.has(verb)) return GH_RAIL_REASON;
  if (rest.some((token) => flagName(token) === '--repo' || token.startsWith('-R'))) {
    return GH_RAIL_REASON;
  }
  const own = (token: string) =>
    token === task.branch || (Boolean(task.pull) && token.replace(/^#/, '') === String(task.pull));
  if (flagValue(rest, ['-H', '--head']).some((head) => head !== task.branch)) return GH_RAIL_REASON;
  if (rest.some((token) => PR_SELECTOR.test(token) && !own(token))) return GH_RAIL_REASON;
  if (positionals(rest).some((token) => !own(token))) return GH_RAIL_REASON;
  return null;
}

function hostingRefusal(command: string, task: TaskBranch): string | null {
  for (const program of commandTree(withoutDataHeredocs(command)).commands) {
    const name = programName(program);
    if (!HOSTING_CLIS.includes(name)) continue;
    const refused = name === 'gh' ? ghRefusal(program.slice(1), task) : REMOTE_RAIL_REASON;
    if (refused) return refused;
  }
  return null;
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

export function publishRefusal(command: string, task: TaskBranch | null): string | null {
  if (gitPublishesBesidesPush(command)) return REMOTE_RAIL_REASON;
  if (!task) return NO_TASK_BRANCH_REASON;
  const hosting = hostingRefusal(command, task);
  if (hosting) return hosting;
  for (const push of pushTargets(command)) {
    const refused = pushRefusal(push, task);
    if (refused) return refused;
  }
  return null;
}

export function publishVerdict(
  command: string,
  posture: ModePosture,
  context: PublishContext,
): PublishVerdict | null {
  if (!publishesCode(command)) return null;
  const basis = publishBasis(posture, context.grant);
  if (!basis) return null;
  const refused = publishRefusal(command, context.task);
  return refused ? { kind: 'refuse', reason: refused } : { kind: 'allow', basis };
}
