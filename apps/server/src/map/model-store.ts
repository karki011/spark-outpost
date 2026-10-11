import type { MapCategory, MapKind } from '@spark-outpost/contracts';
import { redactValue } from '../audit/redact.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import type { JevCall } from '../advisor/jev-calls.ts';
import type { MapModel } from './model.ts';

const ROW_BATCH = 2_000;

async function insertBatches<T>(
  db: Queryable,
  rows: readonly T[],
  sql: string,
  repoId: string,
): Promise<void> {
  for (let start = 0; start < rows.length; start += ROW_BATCH) {
    await db.query(sql, [repoId, JSON.stringify(rows.slice(start, start + ROW_BATCH))]);
  }
}

export async function writeModel(
  db: Db,
  repoId: string,
  model: MapModel,
  rulesVersion: string,
): Promise<void> {
  await withTransaction(db, async (client) => {
    for (const table of ['map_files', 'map_edges', 'map_areas', 'map_area_edges']) {
      await client.query(`DELETE FROM ${table} WHERE repo_id = $1`, [repoId]);
    }
    await insertBatches(
      client,
      model.files.map((file) => ({
        ...file,
        area_id: file.areaId,
        fan_in: file.fanIn,
        fan_out: file.fanOut,
        last_changed_at: file.lastChangedAt,
        change_count: file.changeCount,
        author_count: file.authorCount,
      })),
      `INSERT INTO map_files (repo_id, path, area_id, language, kind, lines, fan_in, fan_out,
         importance, reasons, last_changed_at, change_count, author_count, x, y)
       SELECT $1, r.path, r.area_id, r.language, r.kind, r.lines, r.fan_in, r.fan_out,
         r.importance, r.reasons, r.last_changed_at, r.change_count, r.author_count, r.x, r.y
       FROM jsonb_to_recordset($2::jsonb) AS r (path text, area_id text, language text,
         kind text, lines integer, fan_in integer, fan_out integer, importance real,
         reasons text[], last_changed_at timestamptz, change_count integer,
         author_count integer, x real, y real)`,
      repoId,
    );
    await insertBatches(
      client,
      model.edges,
      `INSERT INTO map_edges (repo_id, from_path, to_path)
       SELECT $1, e->>0, e->>1 FROM jsonb_array_elements($2::jsonb) AS e`,
      repoId,
    );
    await insertBatches(
      client,
      model.areas.map((area) => ({
        ...area,
        file_count: area.fileCount,
        line_count: area.lineCount,
        fan_in: area.fanIn,
        fan_out: area.fanOut,
        top_files: area.topFiles,
        kind_counts: area.kindCounts,
        rule_category: area.ruleCategory,
        rule_kind: area.ruleKind,
      })),
      `INSERT INTO map_areas (repo_id, id, root, source, package, reason, file_count, line_count,
         fan_in, fan_out, importance, top_files, kind_counts, rule_category, rule_kind, x, y,
         radius)
       SELECT $1, r.id, r.root, r.source, r.package, r.reason, r.file_count, r.line_count,
         r.fan_in, r.fan_out, r.importance, r.top_files, r.kind_counts, r.rule_category,
         r.rule_kind, r.x, r.y, r.radius
       FROM jsonb_to_recordset($2::jsonb) AS r (id text, root text, source text, package text,
         reason text, file_count integer, line_count integer, fan_in integer, fan_out integer,
         importance real, top_files text[], kind_counts jsonb, rule_category text,
         rule_kind text, x real, y real, radius real)`,
      repoId,
    );
    await insertBatches(
      client,
      model.areaEdges,
      `INSERT INTO map_area_edges (repo_id, from_area, to_area, weight)
       SELECT $1, r.from, r.to, r.weight
       FROM jsonb_to_recordset($2::jsonb) AS r ("from" text, "to" text, weight integer)`,
      repoId,
    );
    await client.query(
      `DELETE FROM map_labels l WHERE l.repo_id = $1
       AND NOT EXISTS (SELECT 1 FROM map_areas a WHERE a.repo_id = l.repo_id AND a.id = l.area_id)`,
      [repoId],
    );
    await client.query(
      `UPDATE map_repos SET rules_version = $2, file_count = $3, area_count = $4, edge_count = $5,
         updated_at = now()
       WHERE id = $1`,
      [repoId, rulesVersion, model.files.length, model.areas.length, model.edges.length],
    );
  });
}

export interface StoredLabel {
  areaId: string;
  source: 'jev' | 'rules';
  confidence: number | null;
  basis: string[];
  policyVersion: string;
}

export async function storedLabels(
  db: Queryable,
  repoId: string,
): Promise<Map<string, StoredLabel>> {
  const { rows } = await db.query<{
    area_id: string;
    source: 'jev' | 'rules';
    confidence: number | null;
    basis: string[];
    policy_version: string;
  }>(
    'SELECT area_id, source, confidence, basis, policy_version FROM map_labels WHERE repo_id = $1',
    [repoId],
  );
  return new Map(
    rows.map((row) => [
      row.area_id,
      {
        areaId: row.area_id,
        source: row.source,
        confidence: row.confidence,
        basis: row.basis,
        policyVersion: row.policy_version,
      },
    ]),
  );
}

export interface LabelRow {
  areaId: string;
  source: 'jev' | 'rules';
  category: MapCategory;
  kind: MapKind;
  name: string;
  description: string;
  confidence: number | null;
  basis: string[];
  policyVersion: string;
}

export async function saveLabel(db: Queryable, repoId: string, label: LabelRow): Promise<void> {
  await db.query(
    `INSERT INTO map_labels (repo_id, area_id, source, category, kind, name, description,
       confidence, basis, policy_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (repo_id, area_id) DO UPDATE SET source = EXCLUDED.source,
       category = EXCLUDED.category, kind = EXCLUDED.kind, name = EXCLUDED.name,
       description = EXCLUDED.description, confidence = EXCLUDED.confidence,
       basis = EXCLUDED.basis, policy_version = EXCLUDED.policy_version, labelled_at = now()`,
    [
      repoId,
      label.areaId,
      label.source,
      label.category,
      label.kind,
      label.name,
      label.description,
      label.confidence,
      label.basis,
      label.policyVersion,
    ],
  );
}

export interface JevCallRecord {
  purpose: 'area_label' | 'link_match';
  subject: string;
  policyVersion: string;
  call: JevCall;
  fromCache?: boolean;
  answer: unknown;
}

export async function recordJevCall(
  db: Queryable,
  repoId: string,
  record: JevCallRecord,
): Promise<void> {
  if (record.call.status === 'not_connected' || record.call.status === 'not_asked') return;
  await db.query(
    `INSERT INTO map_jev_calls (repo_id, purpose, subject, jev_status, model, input_tokens,
       cost_usd, latency_ms, policy_version, asked, answer, error, from_cache)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      repoId,
      record.purpose,
      record.subject,
      record.call.status,
      record.call.model,
      record.fromCache ? 0 : (record.call.usage?.inputTokens ?? null),
      record.fromCache ? 0 : (record.call.usage?.costUsd ?? null),
      record.call.latencyMs,
      record.policyVersion,
      record.call.asked ? JSON.stringify(redactValue(record.call.asked)) : null,
      JSON.stringify(redactValue(record.answer ?? null)),
      record.call.error,
      record.fromCache === true,
    ],
  );
}
