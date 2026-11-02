import {
  GH_ALLOWED_MAX,
  type OutsideChangeAnswer,
  type SparkRuleChoice,
  type SparkRuleRow,
  type SparkRules,
} from '@spark-outpost/contracts';
import { normalizeCommand } from '../approvals/commands.ts';
import type { SparkRuleContext } from '../approvals/gh-rules.ts';
import {
  acceptOutsideChange,
  changeSparkRules,
  loadSparkRules,
  restoreAcceptedRules,
  sparkRulesFiles,
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

export class SparkRulesInputError extends Error {}

export async function sparkRules(files: SparkRulesFiles = sparkRulesFiles()): Promise<SparkRules> {
  return sparkRulesView(await loadSparkRules(files));
}

const COMPANY_ROW = "Your company's Spark rules set this one, so it can't be changed here.";

export async function setSparkRule(
  row: SparkRuleRow,
  choice: SparkRuleChoice,
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRules> {
  const saved = await changeSparkRules(files, (loaded) => {
    if (rowLocked(loaded.rules, row)) throw new SparkRulesInputError(COMPANY_ROW);
    return choiceChange(row, choice);
  });
  return sparkRulesView(saved);
}

const FULL = `Spark rules hold ${GH_ALLOWED_MAX} allowed commands. Remove one first.`;

export async function setGhAllowed(
  prefix: string,
  allowed: boolean,
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRules> {
  const saved = await changeSparkRules(files, (loaded) => {
    const current = allowedGhPrefixes(loaded.rules);
    const full = allowed && !current.includes(prefix) && current.length >= GH_ALLOWED_MAX;
    if (full) throw new SparkRulesInputError(FULL);
    return ghAllowedChange(prefix, allowed);
  });
  return sparkRulesView(saved);
}

export async function useRecommendedRules(
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRules> {
  return sparkRulesView(await changeSparkRules(files, () => recommendedChange()));
}

export async function answerOutsideChange(
  answer: OutsideChangeAnswer,
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRules> {
  const loaded =
    answer.keep === 'file'
      ? await acceptOutsideChange(files, answer.fileHash)
      : await restoreAcceptedRules(files, answer.fileHash);
  return sparkRulesView(loaded);
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
