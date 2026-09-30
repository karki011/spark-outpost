import type { Db } from '../../../apps/server/src/persistence/db.ts';

export interface PieceRecord {
  key: string;
  title: string;
  status: string;
  placement: string;
  provider: string | null;
  model: string | null;
  owns: string[];
  dependsOn: string[];
  attempts: number;
  fixTurns: number;
  violations: number;
  check: string | null;
  note: string | null;
  providers: string[];
}

export interface BuilderPeak {
  name: string;
  role: string;
  provider: string;
  peakContext: number | null;
  contextSize: number | null;
}

export interface StoryMetrics {
  engaged: boolean | null;
  engageReason: string | null;
  placement: string | null;
  placementReason: string | null;
  listVersions: number;
  pieces: PieceRecord[];
  coordinatorCostUsd: number;
  integratorTurns: number;
  ownershipViolations: number;
  mergeConflictCards: number;
  mergeConflicts: number;
  renumberedMigrations: number;
  providerHandoffs: number;
  contextHandoffs: number;
  providerMoves: number;
  rateLimitErrors: number;
  notesByKind: Record<string, number>;
  builderPeaks: BuilderPeak[];
}

async function allRunIds(db: Db, runIds: readonly string[]): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM runs WHERE id = ANY($1) OR parent_run_id = ANY($1)',
    [runIds],
  );
  return rows.map((row) => row.id);
}

async function engagement(db: Db, ids: readonly string[]) {
  const { rows } = await db.query<{ answer: Record<string, unknown> | null }>(
    `SELECT body->'answer' AS answer FROM run_advice
     WHERE run_id = ANY($1) AND purpose = 'parallel' ORDER BY created_at DESC LIMIT 1`,
    [ids],
  );
  const answer = rows[0]?.answer ?? null;
  return {
    engaged: answer ? Boolean(answer.engage) : null,
    engageReason: answer ? String(answer.detail ?? answer.reason ?? '') : null,
  };
}

async function pieceRows(db: Db, ids: readonly string[]) {
  const lists = await db.query<{ id: string; placement: string; placement_reason: string }>(
    `SELECT id, placement, placement_reason FROM piece_lists
     WHERE orchestration_run_id = ANY($1) ORDER BY version DESC`,
    [ids],
  );
  const latest = lists.rows[0];
  if (!latest) return { list: null, versions: 0, pieces: [] };
  const { rows } = await db.query<{
    key: string;
    title: string;
    status: string;
    placement: string;
    provider: string | null;
    model: string | null;
    owns: string[];
    depends_on: string[];
    attempts: number;
    fix_turns: number;
    violations: unknown[];
    check_status: string | null;
    note: string | null;
  }>(
    `SELECT key, title, status, placement, provider, model, owns, depends_on, attempts, fix_turns,
       violations, check_status, note
     FROM task_pieces WHERE piece_list_id = $1 ORDER BY position`,
    [latest.id],
  );
  return { list: latest, versions: lists.rows.length, pieces: rows };
}

async function pieceProviders(db: Db, ids: readonly string[], key: string): Promise<string[]> {
  const { rows } = await db.query<{ provider: string }>(
    `SELECT provider FROM runs WHERE id = ANY($1) AND role = 'builder' AND prompt LIKE $2
     GROUP BY provider ORDER BY min(created_at)`,
    [ids, `%## Your piece: ${key}%`],
  );
  return rows.map((row) => row.provider);
}

async function scalar(db: Db, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await db.query<{ value: string | number | null }>(sql, params);
  return Number(rows[0]?.value ?? 0);
}

async function notesByKind(db: Db, ids: readonly string[]): Promise<Record<string, number>> {
  const { rows } = await db.query<{ kind: string; count: string }>(
    `SELECT n.kind, count(*) FROM piece_notes n
     JOIN task_pieces p ON p.id = n.piece_id JOIN piece_lists l ON l.id = p.piece_list_id
     WHERE l.orchestration_run_id = ANY($1) GROUP BY n.kind`,
    [ids],
  );
  return Object.fromEntries(rows.map((row) => [row.kind, Number(row.count)]));
}

async function builderPeaks(db: Db, ids: readonly string[]): Promise<BuilderPeak[]> {
  const { rows } = await db.query<{
    name: string | null;
    role: string;
    provider: string;
    peak: number | null;
    size: number | null;
  }>(
    `SELECT route->>'name' AS name, role, provider, max(context_used) AS peak,
       max(context_size) AS size
     FROM runs WHERE id = ANY($1) AND role IN ('builder', 'integrator')
     GROUP BY route->>'name', role, provider ORDER BY min(created_at)`,
    [ids],
  );
  return rows.map((row) => ({
    name: row.name ?? '?',
    role: row.role,
    provider: row.provider,
    peakContext: row.peak,
    contextSize: row.size,
  }));
}

function countInLine(reply: string, label: string, marker: RegExp): number {
  const line = reply.split('\n').find((text) => text.startsWith(label));
  return line ? (line.match(marker) ?? []).length : 0;
}

export async function storyMetrics(
  db: Db,
  runIds: readonly string[],
  reply: string,
): Promise<StoryMetrics> {
  const ids = await allRunIds(db, runIds);
  const { list, versions, pieces } = await pieceRows(db, ids);
  const records: PieceRecord[] = [];
  for (const piece of pieces) {
    records.push({
      key: piece.key,
      title: piece.title,
      status: piece.status,
      placement: piece.placement,
      provider: piece.provider,
      model: piece.model,
      owns: piece.owns,
      dependsOn: piece.depends_on,
      attempts: piece.attempts,
      fixTurns: piece.fix_turns,
      violations: piece.violations.length,
      check: piece.check_status,
      note: piece.note,
      providers: await pieceProviders(db, ids, piece.key),
    });
  }
  const roleCount = (role: string) =>
    scalar(db, 'SELECT count(*) AS value FROM runs WHERE id = ANY($1) AND role = $2', [ids, role]);
  return {
    ...(await engagement(db, ids)),
    placement: list?.placement ?? null,
    placementReason: list?.placement_reason ?? null,
    listVersions: versions,
    pieces: records,
    coordinatorCostUsd: await scalar(
      db,
      `SELECT COALESCE(sum(cost_usd), 0) AS value FROM runs WHERE id = ANY($1) AND role = 'coordinator'`,
      [ids],
    ),
    integratorTurns: await roleCount('integrator'),
    ownershipViolations: records.reduce((sum, piece) => sum + piece.violations, 0),
    mergeConflictCards: await scalar(
      db,
      `SELECT count(*) AS value FROM approvals WHERE run_id = ANY($1) AND kind = 'merge_conflict'`,
      [ids],
    ),
    mergeConflicts: countInLine(reply, 'Merge conflicts:', /\(/g),
    renumberedMigrations: countInLine(reply, 'Renumbered migrations:', /→/g),
    providerHandoffs: await scalar(
      db,
      `SELECT count(*) AS value FROM runs WHERE id = ANY($1) AND role = 'builder'
         AND prompt LIKE '%## Handoff%'`,
      [ids],
    ),
    contextHandoffs: await scalar(
      db,
      `SELECT count(*) AS value FROM run_events WHERE run_id = ANY($1)
         AND payload::text ~* '(context hand-?off|handed off the context)'`,
      [ids],
    ),
    providerMoves: records.reduce((sum, piece) => sum + Math.max(0, piece.providers.length - 1), 0),
    rateLimitErrors: await scalar(
      db,
      `SELECT count(*) AS value FROM runs WHERE id = ANY($1)
         AND error ~* '(429|rate.?limit|too many requests)'`,
      [ids],
    ),
    notesByKind: await notesByKind(db, ids),
    builderPeaks: await builderPeaks(db, ids),
  };
}
