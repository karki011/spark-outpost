import {
  GH_ALLOWED_MAX,
  WORKFLOW_PREFIXES,
  type GhRuleChoice,
  type OutsideChangeAnswer,
  type OutsideChangeView,
  type RuleStanding,
  type SparkRules,
} from '@spark-outpost/contracts';
import { normalizeCommand } from '../approvals/commands.ts';
import type { SparkRuleContext } from '../approvals/gh-rules.ts';
import { WORKFLOW_RULES } from '../spark-rules/recommended.ts';
import { floorEffect, ghCommandRuling } from '../spark-rules/resolve.ts';
import { FLOOR_RULE_IDS, ghPrefixOfRule, ghRuleId } from '../spark-rules/rule-ids.ts';
import { listsDiff } from '../spark-rules/rule-diff.ts';
import {
  NO_RULE_LISTS,
  parseRulesFile,
  RULE_EFFECTS,
  type RuleChange,
  type RuleEffect,
  type RuleLists,
} from '../spark-rules/rules-file.ts';
import {
  acceptOutsideChange,
  changeSparkRules,
  restoreAcceptedRules,
  type RulesFileRead,
  loadSparkRules,
  sparkRulesFiles,
  type LoadedRules,
  type SparkRulesFiles,
} from '../spark-rules/rules-store.ts';
import type { Queryable } from './db.ts';

function allowedPrefixes(loaded: LoadedRules): string[] {
  return loaded.rules.user.allow.flatMap((rule) => {
    const prefix = WORKFLOW_RULES.includes(rule) ? null : ghPrefixOfRule(rule);
    return prefix ? [prefix] : [];
  });
}

function standing(effect: RuleEffect | null | undefined): RuleStanding {
  if (effect === 'deny') return 'refused';
  return effect === 'ask' ? 'asks' : 'mode';
}

const UNNAMED_GH_COMMAND = 'gh unnamed command';

function listsOf(read: RulesFileRead): RuleLists {
  if (read.kind !== 'text') return NO_RULE_LISTS;
  return parseRulesFile(read.text).lists;
}

function outsideView(loaded: LoadedRules): OutsideChangeView | null {
  if (!loaded.outside) return null;
  const accepted: RulesFileRead =
    loaded.outside.accepted === null
      ? { kind: 'missing' }
      : { kind: 'text', text: loaded.outside.accepted };
  const diff = listsDiff(listsOf(accepted), listsOf(loaded.userFile));
  return { fileHash: loaded.outside.fileHash, added: diff.add, removed: diff.remove };
}

function settingsView(loaded: LoadedRules): SparkRules {
  const workflowCommands = WORKFLOW_PREFIXES.map((prefix) => ({
    prefix,
    standing: standing(ghCommandRuling(loaded.rules, prefix)?.effect),
  }));
  const other = ghCommandRuling(loaded.rules, UNNAMED_GH_COMMAND);
  const outside = outsideView(loaded);
  const problems = loaded.problems.map(
    (problem) =>
      `${problem.file === 'managed' ? 'managed-settings.json' : 'settings.json'}: ${problem.message}`,
  );
  return {
    workflows: workflowCommands.every((command) => command.standing === 'refused')
      ? 'refused'
      : 'mode',
    workflowCommands,
    ghAllowed: allowedPrefixes(loaded),
    otherCommands: standing(other?.effect),
    floor: FLOOR_RULE_IDS.map((rule) => ({
      rule,
      standing: standing(floorEffect(loaded.rules, rule)),
    })),
    ...(problems.length > 0 ? { problems } : {}),
    ...(outside ? { outsideChange: outside } : {}),
  };
}

export async function sparkRules(files: SparkRulesFiles = sparkRulesFiles()): Promise<SparkRules> {
  return settingsView(await loadSparkRules(files));
}

type Pairs = (readonly [RuleEffect, string])[];

function settled(to: RuleEffect, rules: readonly string[]): Required<RuleChange> {
  const others = RULE_EFFECTS.filter((effect) => effect !== to);
  return {
    add: rules.map((rule) => [to, rule] as const),
    remove: others.flatMap((effect) => rules.map((rule) => [effect, rule] as const)),
  };
}

function workflowChange(choice: GhRuleChoice): RuleChange {
  return settled(choice === 'refused' ? 'deny' : 'allow', WORKFLOW_RULES);
}

function allowedChange(loaded: LoadedRules, wanted: readonly string[]): RuleChange {
  const current = allowedPrefixes(loaded);
  const dropped: Pairs = current
    .filter((prefix) => !wanted.includes(prefix))
    .map((prefix) => ['allow', ghRuleId(prefix)]);
  const allowed = settled('allow', wanted.map(ghRuleId));
  return { add: allowed.add, remove: [...dropped, ...allowed.remove] };
}

function merged(...changes: RuleChange[]): RuleChange {
  return {
    add: changes.flatMap((change) => change.add ?? []),
    remove: changes.flatMap((change) => change.remove ?? []),
  };
}

export async function saveSparkRules(
  update: { workflows?: GhRuleChoice | undefined; ghAllowed?: readonly string[] | undefined },
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRules> {
  const saved = await changeSparkRules(files, (loaded) =>
    merged(
      update.workflows ? workflowChange(update.workflows) : {},
      update.ghAllowed ? allowedChange(loaded, update.ghAllowed) : {},
    ),
  );
  return settingsView(saved);
}

export async function allowGhPrefix(
  prefix: string,
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<boolean> {
  let fits = true;
  const saved = await changeSparkRules(files, (loaded) => {
    const current = allowedPrefixes(loaded);
    fits = current.includes(prefix) || current.length < GH_ALLOWED_MAX;
    return fits ? allowedChange(loaded, [...new Set([...current, prefix])]) : {};
  });
  return fits && allowedPrefixes(saved).includes(prefix);
}

export async function answerOutsideChange(
  answer: OutsideChangeAnswer,
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRules> {
  const loaded =
    answer.keep === 'file'
      ? await acceptOutsideChange(files, answer.fileHash)
      : await restoreAcceptedRules(files);
  return settingsView(loaded);
}

interface RunRulesRow {
  once: (string | null)[];
}

export async function sparkRulesForRun(
  db: Queryable,
  runId: string,
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRuleContext> {
  const { rows } = await db.query<RunRulesRow>(
    `SELECT ARRAY(
         SELECT a.payload->>'command' FROM approvals a
         JOIN runs card_run ON card_run.id = a.run_id
         WHERE a.rule_answer = 'allow_once' AND card_run.conversation_id = r.conversation_id
           AND (a.rule_retry_run_id IN (r.id, r.parent_run_id)
             OR a.run_id IN (r.id, r.parent_run_id))
       ) AS once
     FROM runs r
     WHERE r.id = $1`,
    [runId],
  );
  const row = rows[0];
  const loaded = await loadSparkRules(files);
  return {
    rules: loaded.rules,
    once: (row?.once ?? []).flatMap((command) => (command ? [normalizeCommand(command)] : [])),
  };
}

export async function markRuleRetry(db: Queryable, cardId: string, runId: string): Promise<void> {
  await db.query('UPDATE approvals SET rule_retry_run_id = $2 WHERE id = $1', [cardId, runId]);
}
