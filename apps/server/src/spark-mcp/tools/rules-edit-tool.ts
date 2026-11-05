import { z } from 'zod';
import {
  RULES_DENY_LABEL,
  RULES_EDIT_MAX,
  RULES_FILE_NAMES,
  RULES_ONCE_LABEL,
  RULES_SESSION_LABEL,
  RULES_SESSION_OPTION,
  ruleLineSchema,
  rulesTargetSchema,
  SPARK_ACTION_OPTION,
  type ApprovalOption,
  type RuleLine,
  type RulesEditAction,
  type RulesTarget,
} from '@spark-outpost/contracts';
import { rulesTextHash } from '../../spark-rules/accepted.ts';
import { effectiveDiff, unrecognisedRules } from '../../spark-rules/rule-diff.ts';
import { NO_RULE_LISTS, parseRulesFile, type RuleLists } from '../../spark-rules/rules-file.ts';
import {
  acceptRulesBaseline,
  loadSparkRules,
  OUTSIDE_CHANGE_REFUSAL,
  readRulesFile,
  sparkRulesFiles,
} from '../../spark-rules/rules-store.ts';
import { actionRun, proposeAction, WAITING_MESSAGE } from '../actions/confirm.ts';
import {
  RULES_RUN_REFUSALS,
  rulesRunRefusal,
  rulesSession,
  sessionGrant,
  waitingCard,
} from '../actions/rules-edit-session.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';

export const RULES_EDIT_TOOL = 'spark_rules_edit';

export const RULES_OPTIONS: readonly ApprovalOption[] = [
  { optionId: RULES_SESSION_OPTION, name: RULES_SESSION_LABEL, kind: 'allow_always' },
  { optionId: SPARK_ACTION_OPTION.confirm, name: RULES_ONCE_LABEL, kind: 'allow_once' },
  { optionId: SPARK_ACTION_OPTION.decline, name: RULES_DENY_LABEL, kind: 'reject_once' },
];

interface Current {
  lists: RuleLists;
  fileHash: string;
}

async function currentRules(target: RulesTarget): Promise<Current> {
  const files = sparkRulesFiles();
  const name = RULES_FILE_NAMES[target];
  if (target === 'user') {
    await acceptRulesBaseline(files);
    const loaded = await loadSparkRules(files);
    if (loaded.outside) throw new SparkToolError(OUTSIDE_CHANGE_REFUSAL);
  }
  const read = await readRulesFile(target === 'user' ? files.user : files.managed);
  if (read.kind === 'unreadable') throw new SparkToolError(`${name} can't be read.`);
  if (read.kind === 'missing') return { lists: NO_RULE_LISTS, fileHash: rulesTextHash(read) };
  const parsed = parseRulesFile(read.text);
  if (parsed.malformed) throw new SparkToolError(`${name} is malformed. Fix the file first.`);
  return { lists: parsed.lists, fileHash: rulesTextHash(read) };
}

function checkedRules(add: readonly RuleLine[], remove: readonly RuleLine[]): void {
  const unknown = unrecognisedRules([...add, ...remove]);
  if (unknown.length > 0) {
    throw new SparkToolError(
      `Not Spark rules: ${unknown.join(', ')}. Use a rule id such as Push, Push(force), PullRequest, SecretFile(edit), GitConfig or Gh(release create) (spark_docs page protected-paths).`,
    );
  }
}

interface EditArgs {
  target: RulesTarget;
  add: RuleLine[];
  remove: RuleLine[];
}

async function edit(args: EditArgs, context: SparkToolContext) {
  const run = actionRun(context.scope);
  const { db } = context.deps;
  const refused = await rulesRunRefusal(db, context.scope);
  if (refused) throw new SparkToolError(RULES_RUN_REFUSALS[refused]);
  checkedRules(args.add, args.remove);
  const session = await rulesSession(db, run.runId);
  if (!session) throw new SparkToolError(RULES_RUN_REFUSALS.no_chat);
  const current = await currentRules(args.target);
  const diff = effectiveDiff(current.lists, args.add, args.remove);
  if (diff.add.length === 0 && diff.remove.length === 0) {
    return { outcome: 'unchanged', message: `${RULES_FILE_NAMES[args.target]} already says that.` };
  }
  const action: RulesEditAction = {
    action: 'rules_edit',
    target: args.target,
    ...diff,
    fileHash: current.fileHash,
    agent: session.agent,
    modeName: session.modeName,
    provider: session.provider,
    agentMode: session.agentMode,
    sessionRow: session.sessionRow,
  };
  const conversationId = context.scope.conversationId!;
  const waiting = await waitingCard(db, conversationId, action);
  if (waiting)
    return { outcome: 'waiting_for_user', approvalId: waiting, message: WAITING_MESSAGE };
  const grant = session.fromUser
    ? await sessionGrant(db, conversationId, args.target, session)
    : null;
  return proposeAction(context, action, {
    path: grant ? 'perform' : 'confirm',
    options: RULES_OPTIONS,
    audit: grant ? { grant: 'session', grantedBy: grant } : { floor: 'spark_rules' },
  });
}

const lines = z.array(ruleLineSchema).max(RULES_EDIT_MAX).default([]);

export const rulesEditTool = sparkTool({
  name: RULES_EDIT_TOOL,
  needs: 'rules_edit',
  acts: true,
  title: 'Change Spark rules',
  description:
    "Only when the user asks: adds or removes Spark rule ids (Push, Push(force), Gh(release create)…; spark_docs protected-paths) in settings.json, or with target managed the company's file (admin password). Lines are {effect: allow|ask|deny, rule}. Always a card for the user.",
  input: {
    target: rulesTargetSchema.default('user'),
    add: lines,
    remove: lines,
  },
  run: (args, context) => edit(args, context),
});
