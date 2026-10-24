import type { InvolvementLevel, ModePosture } from '@spark-outpost/contracts';
import { programName } from './commands.ts';
import {
  gitPublishesBesidesPush,
  hostingCommands,
  hostingRead,
  publishesThroughGit,
  pushTargets,
  reachesHosting,
  type PushTarget,
} from './git-commands.ts';
import { floorEffect, type SparkRuleSet } from '../spark-rules/resolve.ts';
import type { FloorRuleId } from '../spark-rules/rule-ids.ts';
import { followsRule, DEFAULT_RULE_CONTEXT, type SparkRuleContext } from './gh-rules.ts';
import { namesAnotherRepo, ownPullReply, type OwnRepo } from './own-repo.ts';

export interface FollowUpRound {
  workspaceId: string;
  conversationId: string;
}

export type PublishAction = 'push' | 'pull';

export type PublishAsk = Readonly<Record<PublishAction, boolean>>;

export interface PublishGrant {
  level: InvolvementLevel | null;
  requested: boolean;
  asked?: PublishAsk | null;
  followUp?: FollowUpRound | null;
}

export interface StackBase {
  branch: string;
  owner: string;
  onRemote: boolean;
}

export interface AdoptedBranch {
  author: string;
  pull: number;
}

export interface TaskBranch {
  branch: string;
  protectedBranches: readonly string[];
  adopted?: AdoptedBranch | null;
  pull?: number | null;
  stackBase?: StackBase | null;
  pullBase?: string | null;
}

export interface PublishContext {
  grant: PublishGrant;
  task: TaskBranch | null;
}

export type PublishBasis = 'requested' | 'full_auto' | 'follow_up' | 'mode';

export interface PublishBrief {
  basis: PublishBasis;
  branch: string;
  base?: string | null;
}

export type PublishVerdict =
  | { kind: 'allow'; basis: PublishBasis }
  | { kind: 'refuse' | 'ask'; reason: string; rule?: FloorRuleId };

export function ruled(rule: FloorRuleId | null): { rule?: FloorRuleId } {
  return rule ? { rule } : {};
}

export const NO_TASK_BRANCH_REASON =
  "Only this chat's own spark/ branch, or the pull request branch the user adopted for it, can be pushed, and this run isn't on one";

export function adoptedForceReason(branch: string, adopted: AdoptedBranch): string {
  return `${branch} is @${adopted.author}'s pull request #${adopted.pull}: Spark never force pushes it. Update it by merging, then push without force`;
}
export const REMOTE_RAIL_REASON =
  'Changing git remotes, mailing patches and hosting CLIs other than gh stay refused';

export function ghRailReason(subcommand: string): string {
  return `${subcommand} is refused: only gh pr create and gh pr edit on this chat's own pull request are allowed, with comments and thread replies on it while Follow up on pull requests is on, and reading any pull request, check, run or gh api GET is fine`;
}
export const REMOTE_URL_REASON = 'Push to a named remote such as origin, not a URL';
export const WIDE_PUSH_REASON = 'Pushes that delete, prune, mirror or push every ref are refused';

export function otherBranchReason(branch: string): string {
  return `Only this chat's own branch can be pushed, named explicitly: git push origin ${branch}`;
}

export function parentNotPushedReason(
  branch: string,
  stack: Pick<StackBase, 'branch' | 'owner'>,
): string {
  const { owner } = stack;
  return `${branch} can't be pushed yet: it is built on ${owner}'s branch ${stack.branch}, which is not on the remote, so the push would publish ${owner}'s commits under this chat's branch. Push after ${owner}'s branch is pushed; if the user has to act, end with "Needs you: ${owner}'s branch is not pushed".`;
}

const PERFORMING_POSTURES: ReadonlySet<ModePosture> = new Set(['auto', 'full_access']);

function messageAsks(grant: PublishGrant, actions: readonly PublishAction[]): boolean {
  if (!grant.requested) return false;
  const asked = grant.asked;
  return !asked || actions.every((action) => asked[action]);
}

export function publishBasis(
  posture: ModePosture,
  grant: PublishGrant,
  actions: readonly PublishAction[] = [],
): PublishBasis | null {
  if (messageAsks(grant, actions)) return 'requested';
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
  /\b(don['’]?t|do not|never|no need to|without)\s+(push|publish|open|create|make|raise|submit|send|ship|put up)\b(?:(?!\bbut\b)[^.?!\n,;])*/gi;

export function publishAsk(text: string): PublishAsk {
  const undeclined = text.replace(DECLINED, ' ');
  const pull = PR_ASK.test(undeclined);
  return { push: pull || PUSH_ASK.test(undeclined), pull };
}

export function publishRequested(text: string): boolean {
  return publishAsk(text).push;
}

export function requestedBy(text: string): Pick<PublishGrant, 'requested' | 'asked'> {
  const asked = publishAsk(text);
  return { requested: asked.push, asked };
}

export function asksPushOnly(grant: Pick<PublishGrant, 'level' | 'requested' | 'asked'>): boolean {
  return grant.requested && grant.asked?.pull === false && grant.level !== 'full-auto';
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

function ghRefusal(args: readonly string[], task: TaskBranch, own: OwnRepo | null): string | null {
  const [group, verb, ...rest] = args;
  const opens = group === 'pr' && verb !== undefined && GH_PR_WRITES.has(verb);
  if (opens && ownPullTarget(rest, task)) return null;
  return own && ownPullReply(args, own) ? null : ghRailReason(ghSubcommand(args));
}

type Program = readonly string[];

function writesHosting(program: Program): boolean {
  return !hostingRead(program);
}

function writesUnder(command: string, rules: SparkRuleContext): (program: Program) => boolean {
  return (program) => writesHosting(program) && !followsRule(program, command, rules);
}

export function publishesUnder(command: string, rules: SparkRuleContext): boolean {
  return publishesThroughGit(command) || hostingCommands(command).some(writesUnder(command, rules));
}

type Stop = readonly [reason: string, rule: FloorRuleId | null];

function opensPull(args: readonly string[]): boolean {
  const [group, verb] = args;
  return group === 'pr' && verb !== undefined && GH_PR_WRITES.has(verb);
}

function* hostingStops(
  command: string,
  task: TaskBranch,
  judged: (program: Program) => boolean,
  own: OwnRepo | null,
): Generator<Stop> {
  const followed = namesAnotherRepo(command) ? null : own;
  for (const program of hostingCommands(command)) {
    if (!judged(program)) continue;
    if (programName(program) !== 'gh') {
      yield [REMOTE_RAIL_REASON, 'GitRemote'];
      continue;
    }
    const args = program.slice(1);
    const refused = ghRefusal(args, task, followed);
    if (refused) yield [refused, opensPull(args) ? 'PullRequest' : null];
  }
}

function viewsOwnPull(command: string, task: TaskBranch | null): boolean {
  if (!task) return false;
  return hostingCommands(command).every(([, group, verb, ...rest]) => {
    return group === 'pr' && verb === 'view' && ownPullTarget(rest, task);
  });
}

function* pushStops(push: PushTarget, task: TaskBranch): Generator<Stop> {
  if (push.widens) yield [WIDE_PUSH_REASON, 'Push(other)'];
  if (push.remote && /[:/@]/.test(push.remote)) yield [REMOTE_URL_REASON, 'GitRemote'];
  const named = push.branches.length > 0 && push.branches.every((name) => name === task.branch);
  if (!named || task.protectedBranches.includes(task.branch)) {
    yield [otherBranchReason(task.branch), 'Push(other)'];
  }
  if (task.stackBase && !task.stackBase.onRemote) {
    yield [parentNotPushedReason(task.branch, task.stackBase), null];
  }
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

function* stopsAmong(
  command: string,
  task: TaskBranch | null,
  judged: (program: Program) => boolean,
  own: OwnRepo | null,
): Generator<Stop> {
  if (gitPublishesBesidesPush(command)) yield [REMOTE_RAIL_REASON, 'GitRemote'];
  if (!task) {
    const pushes = pushTargets(command).length > 0;
    yield [NO_TASK_BRANCH_REASON, pushes ? 'Push(other)' : 'PullRequest'];
    return;
  }
  yield* hostingStops(command, task, judged, own);
  for (const push of pushTargets(command)) yield* pushStops(push, task);
}

export interface PublishStop {
  kind: 'refuse' | 'ask';
  reason: string;
  rule: FloorRuleId | null;
}

export function firstStop(stops: Iterable<Stop>, rules: SparkRuleSet): PublishStop | null {
  let asked: PublishStop | null = null;
  for (const [reason, rule] of stops) {
    const effect = rule ? floorEffect(rules, rule) : 'deny';
    if (effect === 'deny') return { kind: 'refuse', reason, rule };
    if (effect === 'ask') asked ??= { kind: 'ask', reason, rule };
  }
  return asked;
}

export function publishStop(
  command: string,
  task: TaskBranch | null,
  own: OwnRepo | null = null,
  rules: SparkRuleContext = DEFAULT_RULE_CONTEXT,
): PublishStop | null {
  return firstStop(stopsAmong(command, task, writesUnder(command, rules), own), rules.rules);
}

export function publishRefusal(
  command: string,
  task: TaskBranch | null,
  own: OwnRepo | null = null,
  rules: SparkRuleContext = DEFAULT_RULE_CONTEXT,
): string | null {
  const stop = publishStop(command, task, own, rules);
  return stop?.kind === 'refuse' ? stop.reason : null;
}

export function onlyRepliesOnOwnPull(command: string, own: OwnRepo | null): boolean {
  if (!own || namesAnotherRepo(command) || publishesThroughGit(command)) return false;
  const writes = hostingCommands(command).filter(writesHosting);
  return (
    writes.length > 0 &&
    writes.every((program) => programName(program) === 'gh' && ownPullReply(program.slice(1), own))
  );
}

function publishActions(command: string, rules: SparkRuleContext): PublishAction[] {
  const pushes = pushTargets(command).length > 0;
  const pulls = hostingCommands(command).some(writesUnder(command, rules));
  return [...(pushes ? (['push'] as const) : []), ...(pulls ? (['pull'] as const) : [])];
}

export function publishVerdict(
  command: string,
  posture: ModePosture,
  context: PublishContext,
  own: OwnRepo | null = null,
  rules: SparkRuleContext = DEFAULT_RULE_CONTEXT,
): PublishVerdict | null {
  const verdict = ruledPublishVerdict(command, posture, context, own, rules);
  if (verdict?.kind === 'allow') return verdict;
  return verdict && { kind: verdict.kind, reason: verdict.reason };
}

export function ruledPublishVerdict(
  command: string,
  posture: ModePosture,
  context: PublishContext,
  own: OwnRepo | null = null,
  rules: SparkRuleContext = DEFAULT_RULE_CONTEXT,
): PublishVerdict | null {
  if (!reachesHosting(command) || onlyRepliesOnOwnPull(command, own)) return null;
  const basis = publishBasis(posture, context.grant, publishActions(command, rules));
  if (!basis) return null;
  if (!publishesUnder(command, rules)) {
    return viewsOwnPull(command, context.task) ? { kind: 'allow', basis } : null;
  }
  const stop = publishStop(command, context.task, own, rules);
  if (!stop) return { kind: 'allow', basis };
  return stop.kind === 'refuse'
    ? { kind: 'refuse', reason: stop.reason, ...ruled(stop.rule) }
    : { kind: 'ask', reason: stop.reason, ...ruled(stop.rule) };
}
