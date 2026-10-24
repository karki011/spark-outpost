import { ALLOWED_REASONS, type ModePosture } from '@spark-outpost/contracts';
import type { FloorRuleId } from '../spark-rules/rule-ids.ts';
import type { ApprovalRequest, DecideOptions, Decision } from './decide.ts';
import { programName } from './commands.ts';
import {
  gitPublishesBesidesPush,
  hostingCommands,
  hostingRead,
  publishesBesidesPush,
  pushTargets,
  type ForcePush,
} from './git-commands.ts';
import { DEFAULT_RULE_CONTEXT, followsRule, type SparkRuleContext } from './gh-rules.ts';
import {
  firstStop,
  onlyRepliesOnOwnPull,
  publishesUnder,
  publishStop,
  ruledPublishVerdict,
  type PublishBasis,
  type PublishStop,
  type PublishVerdict,
} from './publish-policy.ts';

export const CHAT_PUBLISH_REASON =
  "This chat's agent pushes and opens a pull request only when the user's message asks for it, the chat is at Full auto → PR, or its mode is Auto or Bypass permissions (Full access)";

export const PUBLISH_ASKED_WHY = ALLOWED_REASONS.publishAsked;
export const PUBLISH_FULL_AUTO_WHY = ALLOWED_REASONS.publishFullAuto;
export const PUBLISH_FOLLOW_UP_WHY = ALLOWED_REASONS.publishFollowUp;

const PULL_WRITES = new Set(['create', 'edit']);

function contextOf(options: DecideOptions): SparkRuleContext {
  return options.sparkRules ?? DEFAULT_RULE_CONTEXT;
}

function soloLeasePush(command: string, forced: ForcePush | null): boolean {
  if (forced?.kind !== 'ask') return false;
  return !publishesBesidesPush(command);
}

function* unaskedStops(command: string, rules: SparkRuleContext) {
  const tag = (rule: FloorRuleId | null) => [CHAT_PUBLISH_REASON, rule] as const;
  if (pushTargets(command).length > 0) yield tag('Push');
  if (gitPublishesBesidesPush(command)) yield tag('GitRemote');
  for (const program of hostingCommands(command)) {
    if (hostingRead(program) || followsRule(program, command, rules)) continue;
    if (programName(program) !== 'gh') {
      yield tag('GitRemote');
      continue;
    }
    const [, group, verb = ''] = program;
    yield tag(group === 'pr' && PULL_WRITES.has(verb) ? 'PullRequest' : null);
  }
}

export function ownAgentStop(
  request: ApprovalRequest,
  options: DecideOptions,
  forced: ForcePush | null,
  published: PublishVerdict | null,
): PublishStop | null {
  const { command } = request;
  const rules = contextOf(options);
  if (!options.changesProject || !command || !publishesUnder(command, rules)) return null;
  if (published) {
    if (published.kind === 'allow' || published.kind === 'mode') return null;
    return { kind: published.kind, reason: published.reason, rule: published.rule ?? null };
  }
  if (onlyRepliesOnOwnPull(command, options.own ?? null)) return null;
  if (!soloLeasePush(command, forced)) {
    const unasked = firstStop(unaskedStops(command, rules), rules.rules);
    if (unasked && unasked.kind !== 'mode') return unasked;
  }
  const stop = publishStop(command, options.publish?.task ?? null, null, rules);
  return stop?.kind === 'mode' ? null : stop;
}

export function publishing(
  posture: ModePosture,
  request: ApprovalRequest,
  options: DecideOptions,
): PublishVerdict | null {
  if (!request.command || !options.publish) return null;
  return ruledPublishVerdict(
    request.command,
    posture,
    options.publish,
    options.own ?? null,
    contextOf(options),
  );
}

export function publishAllowed(basis: PublishBasis): Decision {
  if (basis === 'requested') return { verdict: 'allow', by: 'level', why: PUBLISH_ASKED_WHY };
  if (basis === 'full_auto') return { verdict: 'allow', by: 'level', why: PUBLISH_FULL_AUTO_WHY };
  if (basis === 'follow_up') return { verdict: 'allow', by: 'level', why: PUBLISH_FOLLOW_UP_WHY };
  return { verdict: 'allow', by: 'level' };
}
