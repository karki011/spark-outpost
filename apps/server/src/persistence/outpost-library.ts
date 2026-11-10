import { basename } from 'node:path';
import type {
  ArtifactPageKind,
  LibraryArtifact,
  LibraryFile,
  OutpostLibraryChats,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

interface FileRow {
  id: string;
  conversation_id: string;
  path: string;
  size: string | number;
}

interface ArtifactRow {
  id: string;
  conversation_id: string;
  kind: ArtifactPageKind;
  title: string;
  versions: string | number;
}

function grouped<T extends { conversation_id: string }, V>(
  rows: readonly T[],
  toValue: (row: T) => V,
): Map<string, V[]> {
  const byChat = new Map<string, V[]>();
  for (const row of rows) {
    const list = byChat.get(row.conversation_id) ?? [];
    list.push(toValue(row));
    byChat.set(row.conversation_id, list);
  }
  return byChat;
}

export async function outpostLibrary(
  db: Queryable,
  outpostId: string,
): Promise<OutpostLibraryChats> {
  const [members, files, artifacts] = await Promise.all([
    db.query<{ conversation_id: string }>(
      'SELECT conversation_id FROM outpost_members WHERE outpost_id = $1 ORDER BY position',
      [outpostId],
    ),
    db.query<FileRow>(
      `SELECT f.id, f.conversation_id, f.path, f.size
       FROM chat_files f JOIN outpost_members m ON m.conversation_id = f.conversation_id
       WHERE m.outpost_id = $1 ORDER BY f.created_at, f.path`,
      [outpostId],
    ),
    db.query<ArtifactRow>(
      `SELECT a.id, a.conversation_id, a.kind,
         (array_agg(v.title ORDER BY v.version DESC))[1] AS title, count(*) AS versions
       FROM artifact_pages a
       JOIN outpost_members m ON m.conversation_id = a.conversation_id
       JOIN artifact_page_versions v ON v.artifact_id = a.id AND v.published_at IS NOT NULL
       WHERE m.outpost_id = $1
       GROUP BY a.id ORDER BY a.created_at, a.id`,
      [outpostId],
    ),
  ]);
  const filesByChat = grouped(files.rows, (row): LibraryFile => ({
    id: row.id,
    name: basename(row.path),
    size: Number(row.size),
  }));
  const artifactsByChat = grouped(artifacts.rows, (row): LibraryArtifact => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    versions: Number(row.versions),
  }));
  return {
    chats: members.rows.map(({ conversation_id: conversationId }) => ({
      conversationId,
      files: filesByChat.get(conversationId) ?? [],
      artifacts: artifactsByChat.get(conversationId) ?? [],
    })),
  };
}
