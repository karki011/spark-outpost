import { realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  FILE_FOCUS_ACTIVITY,
  FILE_VIEW_LINES,
  FILE_VIEW_LINE_CHARS,
  fileFocusSchema,
  type FileFocus,
  type FileView,
  type FileViewResponse,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { PathRefusedError, type PathPolicy, type ProjectRoot } from '../projects/path-policy.ts';
import { projectPolicy, readProjectFile, RootMissingError } from '../projects/project-fs.ts';

const LEAD_LINES = 3;
const NOTHING: FileViewResponse = { view: null, refused: null };

interface FocusRow {
  run_id: string;
  content: unknown;
  worktree_path: string | null;
  project_roots: string[];
}

async function latestFocus(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<FocusRow | null> {
  const { rows } = await db.query<FocusRow>(
    `SELECT e.run_id, e.payload->'content' AS content,
            (SELECT w.path FROM run_worktrees w
             WHERE w.run_id = COALESCE((r.route->>'worktreeRun')::uuid, r.id)) AS worktree_path,
            ARRAY(
              SELECT COALESCE(cw.path, p.root_path) FROM conversation_projects cp
              JOIN projects p ON p.id = cp.project_id
              LEFT JOIN chat_worktrees cw ON cw.conversation_id = cp.conversation_id
               AND cw.project_id = cp.project_id AND cw.removed_at IS NULL AND NOT cw.in_place
              WHERE cp.conversation_id = c.id ORDER BY cp.position, cp.created_at
            ) AS project_roots
     FROM run_events e
     JOIN runs r ON r.id = e.run_id
     JOIN conversations c ON c.id = r.conversation_id
     WHERE c.id = $1 AND c.workspace_id = $2
       AND r.status IN ('queued', 'running', 'awaiting_approval')
       AND e.type = 'ACTIVITY_SNAPSHOT' AND e.payload->>'activityType' = $3
     ORDER BY e.created_at DESC, e.seq DESC LIMIT 1`,
    [conversationId, workspaceId, FILE_FOCUS_ACTIVITY],
  );
  return rows[0] ?? null;
}

async function chatPolicy(roots: readonly string[]): Promise<PathPolicy | null> {
  const opened: ProjectRoot[] = [];
  for (const root of roots) {
    try {
      opened.push(...(await projectPolicy([root])).roots);
    } catch (error) {
      if (!(error instanceof RootMissingError)) throw error;
    }
  }
  return opened.length > 0 ? { roots: opened, realpath } : null;
}

function clipLine(line: string): string {
  return line.length > FILE_VIEW_LINE_CHARS ? `${line.slice(0, FILE_VIEW_LINE_CHARS - 1)}…` : line;
}

function focusRange(focus: FileFocus, total: number): { from: number; to: number } | null {
  if (focus.line === null || focus.line > total) return null;
  if (focus.action === 'edit') return { from: focus.line, to: focus.line };
  const to = focus.limit === null ? total : Math.min(total, focus.line + focus.limit - 1);
  return { from: focus.line, to };
}

export function fileWindow(
  text: string,
  focus: FileFocus,
): Pick<FileView, 'firstLine' | 'lines' | 'totalLines' | 'focus'> {
  const all = text.split('\n');
  if (all.at(-1) === '') all.pop();
  const range = focusRange(focus, all.length);
  const firstLine = range ? Math.max(1, range.from - LEAD_LINES) : 1;
  const lines = all.slice(firstLine - 1, firstLine - 1 + FILE_VIEW_LINES).map(clipLine);
  const lastLine = firstLine + lines.length - 1;
  return {
    firstLine,
    lines,
    totalLines: all.length,
    focus: range ? { from: range.from, to: Math.min(range.to, lastLine) } : null,
  };
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export async function chatFileView(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<FileViewResponse> {
  const row = await latestFocus(db, workspaceId, conversationId);
  const focus = fileFocusSchema.safeParse(row?.content);
  if (!row || !focus.success) return NOTHING;
  const roots = [row.worktree_path, ...row.project_roots].flatMap((root) => (root ? [root] : []));
  const policy = await chatPolicy(roots);
  if (!policy) return { view: null, refused: 'outside the project' };
  try {
    const file = await readProjectFile(policy, focus.data.path);
    if (file.data.includes(0)) return { view: null, refused: 'not text' };
    return {
      view: {
        runId: row.run_id,
        action: focus.data.action,
        name: path.basename(file.relative),
        path: file.relative,
        ...fileWindow(file.data.toString('utf8'), focus.data),
      },
      refused: null,
    };
  } catch (error) {
    if (error instanceof PathRefusedError) return { view: null, refused: error.reason };
    if (isMissing(error)) return { view: null, refused: 'not found' };
    throw error;
  }
}
