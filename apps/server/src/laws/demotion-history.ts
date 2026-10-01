import { cardFor } from '../model-cards/cards.ts';
import type { Queryable } from '../persistence/db.ts';
import { demotions, recentRecords, type BuilderOutcome, type Demotion } from './demotion.ts';

const OUTCOME_LIMIT = 2_000;

interface OutcomeRow {
  provider: string;
  model: string;
  label: string | null;
  kind: string;
  verdict: string;
}

export async function builderOutcomes(
  db: Queryable,
  workspaceId: string,
): Promise<(BuilderOutcome & { label: string | null })[]> {
  const { rows } = await db.query<OutcomeRow>(
    `SELECT provider, model, label, kind, verdict FROM (
       SELECT DISTINCT ON (p.id, b.provider, b.model)
         b.provider, b.model, b.route->>'modelLabel' AS label,
         COALESCE(p.category, 'other') AS kind, o.verdict, p.created_at
       FROM runs b
       JOIN runs p ON p.id = b.parent_run_id
       JOIN conversations c ON c.id = p.conversation_id
       JOIN task_outcomes o ON o.run_id = p.id
       WHERE c.workspace_id = $1 AND b.role = 'builder' AND b.model IS NOT NULL
         AND o.verdict IN ('good', 'bad', 'mixed')
       ORDER BY p.id, b.provider, b.model, b.created_at DESC
     ) latest
     ORDER BY created_at DESC LIMIT ${OUTCOME_LIMIT}`,
    [workspaceId],
  );
  return rows.map((row) => ({
    provider: row.provider,
    model: row.model,
    label: row.label,
    kind: row.kind,
    passed: row.verdict === 'good',
  }));
}

export async function loadDemotions(db: Queryable, workspaceId: string): Promise<Demotion[]> {
  const outcomes = await builderOutcomes(db, workspaceId);
  const labels = new Map(outcomes.map((row) => [`${row.provider}:${row.model}`, row.label]));
  const records = recentRecords(outcomes, (provider, model) => {
    const label = labels.get(`${provider}:${model}`) ?? null;
    return {
      label: label ?? model,
      tier: cardFor({ id: model, label }, provider)?.tier ?? null,
    };
  });
  return demotions(records);
}

export async function demotionsFor(
  db: Queryable,
  workspaceId: string,
  kind: string,
): Promise<Demotion[]> {
  return (await loadDemotions(db, workspaceId)).filter((entry) => entry.kind === kind);
}
