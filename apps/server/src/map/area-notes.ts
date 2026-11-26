import { redactText, storableText } from '../audit/redact.ts';
import type { Queryable } from '../persistence/db.ts';
import { isSecretPath } from '../projects/path-policy.ts';

export const NOTE_MAX_CHARS = 4000;
export const NOTE_MAX_SOURCES = 20;

export interface NoteSourceInput {
  path: string;
  startLine: number;
  endLine: number;
}

export interface NoteSource extends NoteSourceInput {
  hash: string;
}

export interface AreaNote {
  text: string;
  sources: NoteSourceInput[];
  writtenAt: string;
  changedSince: string[];
}

export class AreaNoteError extends Error {}

interface IndexedRow {
  path: string;
  area_id: string;
  lines: number;
  content_hash: string | null;
}

async function indexedFiles(
  db: Queryable,
  root: string,
  paths: readonly string[],
): Promise<Map<string, IndexedRow>> {
  const { rows } = await db.query<IndexedRow>(
    `SELECT m.path, m.area_id, m.lines,
       (SELECT f.content_hash FROM code_index_files f
          JOIN code_index_projects p ON p.id = f.project_id
         WHERE p.root_path = r.root_path AND f.path = m.path LIMIT 1) AS content_hash
     FROM map_files m JOIN map_repos r ON r.id = m.repo_id
     WHERE r.root_path = $1 AND m.path = ANY($2::text[])`,
    [root, paths],
  );
  return new Map(rows.map((row) => [row.path, row]));
}

function cleanPath(path: string): string {
  return path.trim().replace(/^\.\//, '');
}

function checkSource(
  source: NoteSourceInput,
  file: IndexedRow | undefined,
  ignore: readonly string[],
): string {
  if (isSecretPath(source.path, ignore)) {
    throw new AreaNoteError(`${source.path} is a secret file and can't be cited.`);
  }
  if (!file || !file.content_hash) {
    throw new AreaNoteError(
      `${source.path} is not on the map. Cite paths relative to the project folder.`,
    );
  }
  if (source.endLine < source.startLine || source.endLine > file.lines) {
    throw new AreaNoteError(
      `${source.path} has ${file.lines} lines; ${source.startLine}-${source.endLine} is outside it.`,
    );
  }
  return file.content_hash;
}

export interface SaveAreaNote {
  root: string;
  areaId: string;
  text: string;
  sources: readonly NoteSourceInput[];
  ignore: readonly string[];
  conversationId: string | null;
}

export async function saveAreaNote(db: Queryable, input: SaveAreaNote): Promise<void> {
  const body = storableText(redactText(input.text)).trim();
  if (body.length === 0) throw new AreaNoteError('The explanation is empty.');
  if (body.length > NOTE_MAX_CHARS) {
    throw new AreaNoteError(`Keep the explanation under ${NOTE_MAX_CHARS} characters.`);
  }
  const cited = input.sources.map((source) => ({ ...source, path: cleanPath(source.path) }));
  const files = await indexedFiles(
    db,
    input.root,
    cited.map((source) => source.path),
  );
  const sources: NoteSource[] = cited.map((source) => ({
    ...source,
    hash: checkSource(source, files.get(source.path), input.ignore),
  }));
  if (!sources.some((source) => files.get(source.path)?.area_id === input.areaId)) {
    throw new AreaNoteError('Cite at least one file from this area.');
  }
  await db.query(
    `INSERT INTO map_area_notes (root_path, area_id, body, sources, conversation_id)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (root_path, area_id) DO UPDATE
       SET body = EXCLUDED.body, sources = EXCLUDED.sources,
           conversation_id = EXCLUDED.conversation_id, written_at = now()`,
    [input.root, input.areaId, body, JSON.stringify(sources), input.conversationId],
  );
}

interface NoteRow {
  body: string;
  sources: NoteSource[];
  written_at: Date;
}

export async function readAreaNote(
  db: Queryable,
  root: string,
  areaId: string,
): Promise<AreaNote | null> {
  const { rows } = await db.query<NoteRow>(
    'SELECT body, sources, written_at FROM map_area_notes WHERE root_path = $1 AND area_id = $2',
    [root, areaId],
  );
  const row = rows[0];
  if (!row) return null;
  const files = await indexedFiles(db, root, [...new Set(row.sources.map((s) => s.path))]);
  const changed = row.sources
    .filter((source) => files.get(source.path)?.content_hash !== source.hash)
    .map((source) => source.path);
  return {
    text: row.body,
    sources: row.sources.map(({ path, startLine, endLine }) => ({ path, startLine, endLine })),
    writtenAt: row.written_at.toISOString(),
    changedSince: [...new Set(changed)],
  };
}
