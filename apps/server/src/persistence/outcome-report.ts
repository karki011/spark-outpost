import type { OutcomeGroup, OutcomeGroupBy, OutcomeReport } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

const GROUP_KEYS: Record<OutcomeGroupBy, string> = {
  day: `to_char(date_trunc('day', r.created_at), 'YYYY-MM-DD')`,
  project: `COALESCE(p.name, 'No project')`,
  provider: `COALESCE(w.provider, r.provider)`,
  model: `COALESCE(w.model, r.used_model, r.model, 'unknown')`,
  category: `COALESCE(r.category, 'unknown')`,
  jev_decision: `CASE
    WHEN a.run_id IS NULL THEN 'no_advice'
    WHEN a.jev_status = 'answered' THEN COALESCE(a.body->>'wouldApply', 'unknown')
    ELSE a.jev_status END`,
  jev_vs_rules: `CASE
    WHEN a.run_id IS NULL OR jsonb_typeof(a.body->'jev') IS DISTINCT FROM 'object' THEN 'no_jev'
    WHEN jsonb_array_length(COALESCE(a.body->'differences', '[]'::jsonb)) = 0 THEN 'same'
    ELSE 'differs' END`,
};

const signalCount = (kind: string) =>
  `count(*) FILTER (WHERE EXISTS (
     SELECT 1 FROM outcome_signals s WHERE s.run_id = o.run_id AND s.kind = '${kind}'
   ))::int`;

interface GroupRow {
  key: string;
  turns: number;
  good: number;
  bad: number;
  mixed: number;
  unclear: number;
  mean_score: number | null;
  rated: number;
  thumbs_up: number;
  thumbs_down: number;
  prompted: number;
  sampled: number;
  kept: number;
  reverted: number;
  committed: number;
  corrections: number;
}

function toGroup(row: GroupRow): OutcomeGroup {
  return {
    key: row.key,
    turns: row.turns,
    good: row.good,
    bad: row.bad,
    mixed: row.mixed,
    unclear: row.unclear,
    meanScore: row.mean_score === null ? null : Math.round(row.mean_score * 1000) / 1000,
    rated: row.rated,
    thumbsUp: row.thumbs_up,
    thumbsDown: row.thumbs_down,
    prompted: row.prompted,
    sampled: row.sampled,
    kept: row.kept,
    reverted: row.reverted,
    committed: row.committed,
    corrections: row.corrections,
  };
}

export async function outcomeReport(
  db: Queryable,
  workspaceId: string,
  groupBy: OutcomeGroupBy,
  days: number,
): Promise<OutcomeReport> {
  const { rows } = await db.query<GroupRow>(
    `SELECT ${GROUP_KEYS[groupBy]} AS key,
       count(*)::int AS turns,
       count(*) FILTER (WHERE o.verdict = 'good')::int AS good,
       count(*) FILTER (WHERE o.verdict = 'bad')::int AS bad,
       count(*) FILTER (WHERE o.verdict = 'mixed')::int AS mixed,
       count(*) FILTER (WHERE o.verdict = 'unclear')::int AS unclear,
       avg(o.score)::float8 AS mean_score,
       count(o.rating)::int AS rated,
       count(*) FILTER (WHERE o.rating = 'up')::int AS thumbs_up,
       count(*) FILTER (WHERE o.rating = 'down')::int AS thumbs_down,
       count(o.prompt)::int AS prompted,
       count(*) FILTER (WHERE o.prompt = 'sampled')::int AS sampled,
       ${signalCount('kept')} AS kept,
       ${signalCount('reverted')} AS reverted,
       ${signalCount('committed')} AS committed,
       ${signalCount('correction')} AS corrections
     FROM task_outcomes o
     JOIN runs r ON r.id = o.run_id
     JOIN conversations c ON c.id = r.conversation_id
     LEFT JOIN conversation_projects cp ON cp.conversation_id = c.id AND cp.position = 0
     LEFT JOIN projects p ON p.id = cp.project_id
     LEFT JOIN run_advice a ON a.run_id = r.id AND a.purpose = 'intake'
     LEFT JOIN LATERAL (
       SELECT ch.provider, COALESCE(ch.used_model, ch.model) AS model FROM runs ch
       WHERE ch.parent_run_id = r.id
       ORDER BY (ch.role = 'builder') DESC, ch.created_at DESC
       LIMIT 1
     ) w ON true
     WHERE c.workspace_id = $1 AND r.created_at > now() - make_interval(days => $2)
     GROUP BY 1
     ORDER BY 1`,
    [workspaceId, days],
  );
  return { groupBy, days, groups: rows.map(toGroup) };
}
