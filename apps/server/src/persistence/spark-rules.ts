import {
  DEFAULT_SPARK_RULES,
  GH_ALLOWED_MAX,
  type GhRuleChoice,
  type SparkRuleChoice,
  type SparkRuleRow,
  type SparkRules,
} from '@spark-outpost/contracts';
import { normalizeCommand } from '../approvals/commands.ts';
import type { SparkRuleContext } from '../approvals/gh-rules.ts';
import type { GhSeed } from '../spark-rules/recommended.ts';
import type { RuleChange } from '../spark-rules/rules-file.ts';
import {
  changeSparkRules,
  loadSparkRules,
  seedSparkRules,
  sparkRulesFiles,
  type LoadedRules,
  type SparkRulesFiles,
} from '../spark-rules/rules-store.ts';
import {
  allowedGhPrefixes,
  choiceChange,
  ghAllowedChange,
  recommendedChange,
  rowLocked,
  sparkRulesView,
} from '../spark-rules/rules-view.ts';
import type { Queryable } from './db.ts';

interface SeedRow {
  gh_workflows: GhRuleChoice;
  gh_allowed: string[];
}

function seedOf(row: SeedRow | undefined): GhSeed {
  if (!row) return DEFAULT_SPARK_RULES;
  return { workflows: row.gh_workflows, ghAllowed: row.gh_allowed };
}

async function ghSeed(db: Queryable, workspaceId: string): Promise<GhSeed> {
  const { rows } = await db.query<SeedRow>(
    'SELECT gh_workflows, gh_allowed FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  return seedOf(rows[0]);
}

export class SparkRulesInputError extends Error {}

async function changed(
  db: Queryable,
  workspaceId: string,
  files: SparkRulesFiles,
  change: (loaded: LoadedRules) => RuleChange,
): Promise<LoadedRules> {
  return changeSparkRules(files, await ghSeed(db, workspaceId), change);
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
  return sparkRulesView(await loadSparkRules(files, await ghSeed(db, workspaceId)));
}

const COMPANY_ROW = "Your company's Spark rules set this one, so it can't be changed here.";

export async function setSparkRule(
  db: Queryable,
  workspaceId: string,
  row: SparkRuleRow,
  choice: SparkRuleChoice,
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRules> {
  const saved = await changed(db, workspaceId, files, (loaded) => {
    if (rowLocked(loaded.rules, row)) throw new SparkRulesInputError(COMPANY_ROW);
    return choiceChange(row, choice);
  });
  return sparkRulesView(saved);
}

const FULL = `Spark rules hold ${GH_ALLOWED_MAX} allowed commands. Remove one first.`;

export async function setGhAllowed(
  db: Queryable,
  workspaceId: string,
  prefix: string,
  allowed: boolean,
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRules> {
  const saved = await changed(db, workspaceId, files, (loaded) => {
    const current = allowedGhPrefixes(loaded.rules);
    const full = allowed && !current.includes(prefix) && current.length >= GH_ALLOWED_MAX;
    if (full) throw new SparkRulesInputError(FULL);
    return ghAllowedChange(prefix, allowed);
  });
  return sparkRulesView(saved);
}

export async function useRecommendedRules(
  db: Queryable,
  workspaceId: string,
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRules> {
  return sparkRulesView(await changed(db, workspaceId, files, () => recommendedChange()));
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
