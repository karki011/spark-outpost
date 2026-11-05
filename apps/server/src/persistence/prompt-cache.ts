import { z } from 'zod';
import type { CacheTtlSeconds, PromptCache } from '@spark-outpost/contracts';
import type { RequestUsage } from '../providers/provider.ts';
import {
  buildPromptCache,
  cacheTtlOf,
  contextOf,
  type CacheResume,
  type RunCacheRow,
  type SessionCache,
} from '../usage/prompt-cache.ts';
import type { Queryable } from './db.ts';
import { storedLabel } from './native-terminal-steps.ts';

export interface CacheRequest {
  key: string;
  write: number;
  context: number;
  at: Date;
  model: string | null;
  ttlSeconds: CacheTtlSeconds | null;
}

const NEWER = (column: string) =>
  `CASE WHEN EXCLUDED.last_at >= run_prompt_cache.last_at
     THEN EXCLUDED.${column} ELSE run_prompt_cache.${column} END`;

export async function recordCacheRequest(
  db: Queryable,
  runId: string,
  request: CacheRequest,
): Promise<void> {
  await db.query(
    `INSERT INTO run_prompt_cache (run_id, first_key, first_write, last_key, last_context, last_at,
       model, ttl_seconds)
     SELECT id, $2, $3, $2, $4, $5, $6, $7 FROM runs WHERE id = $1
     ON CONFLICT (run_id) DO UPDATE SET
       first_write = CASE WHEN run_prompt_cache.first_key = EXCLUDED.first_key
         THEN EXCLUDED.first_write ELSE run_prompt_cache.first_write END,
       last_key = ${NEWER('last_key')},
       last_context = ${NEWER('last_context')},
       model = CASE WHEN EXCLUDED.last_at >= run_prompt_cache.last_at
         THEN COALESCE(EXCLUDED.model, run_prompt_cache.model) ELSE run_prompt_cache.model END,
       ttl_seconds = CASE WHEN EXCLUDED.last_at >= run_prompt_cache.last_at
         THEN COALESCE(EXCLUDED.ttl_seconds, run_prompt_cache.ttl_seconds)
         ELSE COALESCE(run_prompt_cache.ttl_seconds, EXCLUDED.ttl_seconds) END,
       last_at = GREATEST(EXCLUDED.last_at, run_prompt_cache.last_at)`,
    [
      runId,
      storedLabel(request.key),
      request.write,
      request.context,
      request.at,
      request.model === null ? null : storedLabel(request.model),
      request.ttlSeconds,
    ],
  );
}

export function recordRequestUsage(
  db: Queryable,
  runId: string,
  request: RequestUsage,
  at: Date,
): Promise<void> {
  return recordCacheRequest(db, runId, {
    key: request.key,
    write: request.cachedWrite,
    context: contextOf(request),
    at,
    model: request.model,
    ttlSeconds: cacheTtlOf(request.buckets),
  });
}

export async function moveCacheRecord(
  db: Queryable,
  runId: string,
  ownerRunId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO run_prompt_cache (run_id, first_key, first_write, last_key, last_context, last_at,
       model, ttl_seconds)
     SELECT $2, first_key, first_write, last_key, last_context, last_at, model, ttl_seconds
     FROM run_prompt_cache WHERE run_id = $1
     ON CONFLICT (run_id) DO UPDATE SET
       last_key = ${NEWER('last_key')},
       last_context = ${NEWER('last_context')},
       model = ${NEWER('model')},
       ttl_seconds = COALESCE(${NEWER('ttl_seconds')}, run_prompt_cache.ttl_seconds,
         EXCLUDED.ttl_seconds),
       last_at = GREATEST(EXCLUDED.last_at, run_prompt_cache.last_at)`,
    [runId, ownerRunId],
  );
}

export async function recordSessionCacheTtl(
  db: Queryable,
  sessionId: string,
  ttl: CacheTtlSeconds,
): Promise<void> {
  await db.query('UPDATE native_terminal_sessions SET cache_ttl_seconds = $2 WHERE id = $1', [
    sessionId,
    ttl,
  ]);
}

export async function recordCacheResume(
  db: Queryable,
  sessionId: string,
  resume: CacheResume,
): Promise<void> {
  await db.query('UPDATE native_terminal_sessions SET cache_resume = $2::jsonb WHERE id = $1', [
    sessionId,
    JSON.stringify(resume),
  ]);
}

export interface LongWrite {
  model: string;
  tokens: number;
}

export async function recordLongWrites(
  db: Queryable,
  runId: string,
  writes: readonly LongWrite[],
): Promise<boolean> {
  let changed = false;
  for (const write of writes) {
    const { rowCount } = await db.query(
      `INSERT INTO native_terminal_long_writes (run_id, model, tokens)
       SELECT id, $2, $3 FROM runs WHERE id = $1
       ON CONFLICT (run_id, model) DO UPDATE SET tokens = EXCLUDED.tokens
       WHERE native_terminal_long_writes.tokens <> EXCLUDED.tokens`,
      [runId, storedLabel(write.model), write.tokens],
    );
    if ((rowCount ?? 0) > 0) changed = true;
  }
  return changed;
}

export async function longWritesByModel(
  db: Queryable,
  runId: string,
): Promise<Map<string, number>> {
  const { rows } = await db.query<{ model: string; tokens: number }>(
    'SELECT model, tokens FROM native_terminal_long_writes WHERE run_id = $1',
    [runId],
  );
  return new Map(rows.map((row) => [row.model, row.tokens]));
}

interface CacheRow {
  run_id: string;
  provider: string;
  model: string | null;
  first_write: number;
  last_context: number;
  last_at: Date;
  ttl_seconds: CacheTtlSeconds | null;
}

interface SessionRow {
  provider: string;
  model: string | null;
  cache_ttl_seconds: CacheTtlSeconds | null;
  cache_resume: unknown;
}

const count = z.number().int().nonnegative();
const resumeSchema = z.object({
  at: z.number().int().positive(),
  secondsSince: count.nullable(),
  contextTokens: count,
  likelyExpired: z.boolean().nullable(),
  estimatedWriteUsd: z.number().nonnegative().nullable(),
});

function sessionCache(row: SessionRow | undefined): SessionCache | null {
  if (!row) return null;
  return {
    provider: row.provider,
    model: row.model,
    ttlSeconds: row.cache_ttl_seconds,
    resume: resumeSchema.safeParse(row.cache_resume).data ?? null,
  };
}

export async function promptCacheFor(db: Queryable, conversationId: string): Promise<PromptCache> {
  const [cache, session, working] = await Promise.all([
    db.query<CacheRow>(
      `SELECT p.run_id, r.provider, COALESCE(p.model, r.used_model, r.model) AS model,
         p.first_write, p.last_context, p.last_at, p.ttl_seconds
       FROM run_prompt_cache p JOIN runs r ON r.id = p.run_id
       WHERE r.conversation_id = $1 AND r.parent_run_id IS NULL
       ORDER BY r.created_at, p.last_at`,
      [conversationId],
    ),
    db.query<SessionRow>(
      `SELECT s.provider, (SELECT COALESCE(r.used_model, r.model) FROM runs r
           WHERE r.conversation_id = s.conversation_id ORDER BY r.created_at DESC LIMIT 1) AS model,
         s.cache_ttl_seconds, s.cache_resume
       FROM native_terminal_sessions s WHERE s.conversation_id = $1`,
      [conversationId],
    ),
    db.query<{ working: number }>(
      `SELECT count(*)::int AS working FROM native_terminal_mod_turns m
       WHERE m.agent_id IS NOT NULL AND m.started_at IS NOT NULL AND m.duration_ms IS NULL
         AND m.run_id = (SELECT r.id FROM runs r WHERE r.conversation_id = $1
           AND r.parent_run_id IS NULL ORDER BY r.created_at DESC LIMIT 1)`,
      [conversationId],
    ),
  ]);
  const rows: RunCacheRow[] = cache.rows.map((row) => ({
    runId: row.run_id,
    provider: row.provider,
    model: row.model,
    firstWrite: row.first_write,
    lastContext: row.last_context,
    lastAt: row.last_at,
    ttlSeconds: row.ttl_seconds,
  }));
  return buildPromptCache(rows, sessionCache(session.rows[0]), working.rows[0]?.working ?? 0);
}
