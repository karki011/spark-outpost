import { basename } from 'node:path';
import { ATTACHMENT_IMAGE_TYPES, type ChatFile } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';

export const CHAT_FILE_PATH_MAX = 1024;

export interface KnownFile {
  path: string;
  size: number;
  changedMs: number;
  sha256: string;
}

export interface NewChatFile extends KnownFile {
  id: string;
  mediaType: string;
}

interface ChatFileRow {
  id: string;
  conversation_id: string;
  run_id: string;
  path: string;
  size: string;
  media_type: string;
}

const IMAGE_TYPES: ReadonlySet<string> = new Set(ATTACHMENT_IMAGE_TYPES);

function toChatFile(row: ChatFileRow): ChatFile {
  return {
    id: row.id,
    runId: row.run_id,
    name: basename(row.path),
    path: row.path,
    size: Number(row.size),
    mediaType: row.media_type,
    kind: IMAGE_TYPES.has(row.media_type) ? 'image' : 'file',
  };
}

export async function knownChatFiles(
  db: Queryable,
  conversationId: string,
): Promise<Map<string, KnownFile>> {
  const { rows } = await db.query<{
    path: string;
    size: string;
    changed_ms: number;
    sha256: string;
  }>(
    `SELECT DISTINCT ON (path) path, size, changed_ms, sha256 FROM chat_files
     WHERE conversation_id = $1 ORDER BY path, created_at DESC, id DESC`,
    [conversationId],
  );
  return new Map(
    rows.map((row) => [
      row.path,
      { path: row.path, size: Number(row.size), changedMs: row.changed_ms, sha256: row.sha256 },
    ]),
  );
}

export async function insertChatFile(
  db: Queryable,
  conversationId: string,
  runId: string,
  file: NewChatFile,
): Promise<void> {
  await db.query(
    `INSERT INTO chat_files (id, conversation_id, run_id, path, size, changed_ms, sha256, media_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      file.id,
      conversationId,
      runId,
      file.path,
      file.size,
      file.changedMs,
      file.sha256,
      file.mediaType,
    ],
  );
}

export async function listChatFiles(db: Queryable, conversationId: string): Promise<ChatFile[]> {
  const { rows } = await db.query<ChatFileRow>(
    `SELECT f.id, f.conversation_id, COALESCE(r.parent_run_id, f.run_id) AS run_id, f.path,
            f.size, f.media_type
     FROM chat_files f JOIN runs r ON r.id = f.run_id
     WHERE f.conversation_id = $1 ORDER BY f.created_at, f.path`,
    [conversationId],
  );
  return rows.map(toChatFile);
}

export interface StoredChatFile {
  file: ChatFile;
  conversationId: string;
}

export async function findChatFile(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<StoredChatFile | null> {
  const { rows } = await db.query<ChatFileRow>(
    `SELECT f.id, f.conversation_id, f.run_id, f.path, f.size, f.media_type
     FROM chat_files f JOIN conversations c ON c.id = f.conversation_id
     WHERE f.id = $1 AND c.workspace_id = $2`,
    [id, workspaceId],
  );
  const row = rows[0];
  return row ? { file: toChatFile(row), conversationId: row.conversation_id } : null;
}
