import {
  DEFAULT_SPARK_RULES,
  GH_ALLOWED_MAX,
  WORKFLOW_PREFIXES,
  type GhRuleChoice,
  type OutsideChangeAnswer,
  type OutsideChangeView,
  type SparkRules,
} from '@spark-outpost/contracts';
import { normalizeCommand } from '../approvals/commands.ts';
import type { SparkRuleContext } from '../approvals/gh-rules.ts';
import { WORKFLOW_RULES, type GhSeed } from '../spark-rules/recommended.ts';
import { ghCommandRuling } from '../spark-rules/resolve.ts';
import { ghPrefixOfRule, ghRuleId } from '../spark-rules/rule-ids.ts';
import { listsDiff } from '../spark-rules/rule-diff.ts';
import {
  NO_RULE_LISTS,
  parseRulesFile,
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
  seedSparkRules,
  sparkRulesFiles,
  type LoadedRules,
  type SparkRulesFiles,
} from '../spark-rules/rules-store.ts';
import type { Queryable } from './db.ts';

interface SeedRow {
  gh_workflows: GhRuleChoice;
  gh_allowed: string[];
}

function seedOf(row: SeedRow | undefined): GhSeed {
  if (!row) return DEFAULT_SPARK_RULES;
  return { workflows: row.gh_workflows, ghAllowed: row.gh_allowed };
}

export async function ghSeed(db: Queryable, workspaceId: string): Promise<GhSeed> {
  const { rows } = await db.query<SeedRow>(
    'SELECT gh_workflows, gh_allowed FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  return seedOf(rows[0]);
}

function allowedPrefixes(loaded: LoadedRules): string[] {
  return loaded.rules.user.allow.flatMap((rule) => {
    const prefix = WORKFLOW_RULES.includes(rule) ? null : ghPrefixOfRule(rule);
    return prefix ? [prefix] : [];
  });
}

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
  const workflow = ghCommandRuling(loaded.rules, WORKFLOW_PREFIXES[0]);
  const outside = outsideView(loaded);
  const problems = loaded.problems.map(
    (problem) =>
      `${problem.file === 'managed' ? 'managed-settings.json' : 'settings.json'}: ${problem.message}`,
  );
  return {
    workflows: workflow?.effect === 'deny' ? 'refused' : 'mode',
    ghAllowed: allowedPrefixes(loaded),
    ...(problems.length > 0 ? { problems } : {}),
    ...(outside ? { outsideChange: outside } : {}),
  };
}

export async function seedWorkspaceRules(
  db: Queryable,
  workspaceId: string,
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<boolean> {
  return seedSparkRules(files, await ghSeed(db, workspaceId));
}

export async function sparkRules(
  db: Queryable,
  workspaceId: string,
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRules> {
  return settingsView(await loadSparkRules(files, await ghSeed(db, workspaceId)));
}

type Pairs = (readonly [RuleEffect, string])[];

function workflowChange(choice: GhRuleChoice): RuleChange {
  const [to, from]: [RuleEffect, RuleEffect] =
    choice === 'refused' ? ['deny', 'allow'] : ['allow', 'deny'];
  return {
    add: WORKFLOW_RULES.map((rule) => [to, rule] as const),
    remove: WORKFLOW_RULES.map((rule) => [from, rule] as const),
  };
}

function allowedChange(loaded: LoadedRules, wanted: readonly string[]): RuleChange {
  const current = allowedPrefixes(loaded);
  const dropped: Pairs = current
    .filter((prefix) => !wanted.includes(prefix))
    .map((prefix) => ['allow', ghRuleId(prefix)]);
  const added = wanted.map(ghRuleId);
  return {
    add: added.map((rule) => ['allow', rule] as const),
    remove: [...dropped, ...added.map((rule) => ['deny', rule] as const)],
  };
}

function merged(...changes: RuleChange[]): RuleChange {
  return {
    add: changes.flatMap((change) => change.add ?? []),
    remove: changes.flatMap((change) => change.remove ?? []),
  };
}

export async function saveSparkRules(
  db: Queryable,
  workspaceId: string,
  update: { workflows?: GhRuleChoice | undefined; ghAllowed?: readonly string[] | undefined },
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRules> {
  const saved = await changeSparkRules(files, await ghSeed(db, workspaceId), (loaded) =>
    merged(
      update.workflows ? workflowChange(update.workflows) : {},
      update.ghAllowed ? allowedChange(loaded, update.ghAllowed) : {},
    ),
  );
  return settingsView(saved);
}

export async function allowGhPrefix(
  db: Queryable,
  workspaceId: string,
  prefix: string,
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<boolean> {
  let fits = true;
  const saved = await changeSparkRules(files, await ghSeed(db, workspaceId), (loaded) => {
    const current = allowedPrefixes(loaded);
    fits = current.includes(prefix) || current.length < GH_ALLOWED_MAX;
    return fits ? allowedChange(loaded, [...new Set([...current, prefix])]) : {};
  });
  return fits && allowedPrefixes(saved).includes(prefix);
}

export async function answerOutsideChange(
  db: Queryable,
  workspaceId: string,
  answer: OutsideChangeAnswer,
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRules> {
  const gh = await ghSeed(db, workspaceId);
  const loaded =
    answer.keep === 'file'
      ? await acceptOutsideChange(files, gh, answer.fileHash)
      : await restoreAcceptedRules(files, gh);
  return settingsView(loaded);
}

interface RunRulesRow extends SeedRow {
  once: (string | null)[];
}

export async function sparkRulesForRun(
  db: Queryable,
  runId: string,
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRuleContext> {
  const { rows } = await db.query<RunRulesRow>(
    `SELECT COALESCE(p.gh_workflows, $2) AS gh_workflows,
       COALESCE(p.gh_allowed, '{}') AS gh_allowed,
       ARRAY(
         SELECT a.payload->>'command' FROM approvals a
         JOIN runs card_run ON card_run.id = a.run_id
         WHERE a.rule_answer = 'allow_once' AND card_run.conversation_id = r.conversation_id
           AND (a.rule_retry_run_id IN (r.id, r.parent_run_id)
             OR a.run_id IN (r.id, r.parent_run_id))
       ) AS once
     FROM runs r
     JOIN conversations c ON c.id = r.conversation_id
     LEFT JOIN profiles p ON p.workspace_id = c.workspace_id
     WHERE r.id = $1`,
    [runId, DEFAULT_SPARK_RULES.workflows],
  );
  const row = rows[0];
  const loaded = await loadSparkRules(files, seedOf(row));
  return {
    rules: loaded.rules,
    once: (row?.once ?? []).flatMap((command) => (command ? [normalizeCommand(command)] : [])),
  };
}

export async function markRuleRetry(db: Queryable, cardId: string, runId: string): Promise<void> {
  await db.query('UPDATE approvals SET rule_retry_run_id = $2 WHERE id = $1', [cardId, runId]);
}
