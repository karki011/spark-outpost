import {
  DEFAULT_SPARK_RULES,
  GH_ALLOWED_MAX,
  type GhRuleChoice,
  type SparkRules,
} from '@spark-outpost/contracts';
import { normalizeCommand } from '../approvals/commands.ts';
import type { GhRules } from '../approvals/gh-rules.ts';
import type { Queryable } from './db.ts';

interface RulesRow {
  gh_workflows: GhRuleChoice;
  gh_allowed: string[];
}

function toRules(row: RulesRow | undefined): SparkRules {
  if (!row) return DEFAULT_SPARK_RULES;
  return { workflows: row.gh_workflows, ghAllowed: row.gh_allowed };
}

export async function sparkRules(db: Queryable, workspaceId: string): Promise<SparkRules> {
  const { rows } = await db.query<RulesRow>(
    'SELECT gh_workflows, gh_allowed FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  return toRules(rows[0]);
}

async function ensureProfile(db: Queryable, workspaceId: string): Promise<void> {
  await db.query('INSERT INTO profiles (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING', [
    workspaceId,
  ]);
}

export async function saveSparkRules(
  db: Queryable,
  workspaceId: string,
  update: { workflows?: GhRuleChoice | undefined; ghAllowed?: readonly string[] | undefined },
): Promise<SparkRules> {
  await ensureProfile(db, workspaceId);
  const { rows } = await db.query<RulesRow>(
    `UPDATE profiles SET
       gh_workflows = COALESCE($2, gh_workflows),
       gh_allowed = COALESCE($3::text[], gh_allowed),
       updated_at = now()
     WHERE workspace_id = $1
     RETURNING gh_workflows, gh_allowed`,
    [workspaceId, update.workflows ?? null, update.ghAllowed ?? null],
  );
  return toRules(rows[0]);
}

export async function allowGhPrefix(
  db: Queryable,
  workspaceId: string,
  prefix: string,
): Promise<boolean> {
  await ensureProfile(db, workspaceId);
  const { rowCount } = await db.query(
    `UPDATE profiles SET gh_allowed = array_append(gh_allowed, $2), updated_at = now()
     WHERE workspace_id = $1 AND NOT ($2 = ANY (gh_allowed))
       AND cardinality(gh_allowed) < $3`,
    [workspaceId, prefix, GH_ALLOWED_MAX],
  );
  if (rowCount === 1) return true;
  const rules = await sparkRules(db, workspaceId);
  return rules.ghAllowed.includes(prefix);
}

interface RunRulesRow extends RulesRow {
  once: (string | null)[];
}

export async function ghRulesForRun(db: Queryable, runId: string): Promise<GhRules> {
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
  if (!row) return { workflows: DEFAULT_SPARK_RULES.workflows, allowed: [], once: [] };
  return {
    workflows: row.gh_workflows,
    allowed: row.gh_allowed,
    once: row.once.flatMap((command) => (command ? [normalizeCommand(command)] : [])),
  };
}

export async function markRuleRetry(db: Queryable, cardId: string, runId: string): Promise<void> {
  await db.query('UPDATE approvals SET rule_retry_run_id = $2 WHERE id = $1', [cardId, runId]);
}
