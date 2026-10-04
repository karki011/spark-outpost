import { stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChatPreview, PreviewConfig } from '@spark-outpost/contracts';
import { liveChatWorktree } from '../persistence/chat-worktrees.ts';
import type { Db, Queryable } from '../persistence/db.ts';
import {
  askPreviewStart,
  nudgePreviews,
  previewRow,
  previewRowAt,
  toPreviewServer,
  type PreviewAsk,
  type PreviewRow,
} from '../persistence/preview-servers.ts';
import { storedPreview } from '../projects/projects.ts';

export interface PreviewPlace {
  workspaceId: string;
  projectId: string;
  projectName: string;
  rootPath: string;
  preview: PreviewConfig | null;
  folder: string;
}

export const PREVIEW_NOT_SET_UP =
  'This project has no preview set up. The user can add one in Settings, Projects, Preview (the command that starts the dev server and its address). Agents cannot set it.';

export class PreviewNotSetUpError extends Error {
  constructor() {
    super(PREVIEW_NOT_SET_UP);
  }
}

interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  preview: unknown;
}

async function isFolder(target: string): Promise<boolean> {
  return stat(target).then(
    (info) => info.isDirectory(),
    () => false,
  );
}

export async function chatPreviewPlace(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<PreviewPlace | null> {
  const { rows } = await db.query<ProjectRow>(
    `SELECT p.id, p.name, p.root_path, p.preview FROM conversations c
     JOIN conversation_projects cp ON cp.conversation_id = c.id
     JOIN projects p ON p.id = cp.project_id
     WHERE c.id = $1 AND c.workspace_id = $2
     ORDER BY cp.position, cp.created_at LIMIT 1`,
    [conversationId, workspaceId],
  );
  const project = rows[0];
  if (!project) return null;
  const worktree = await liveChatWorktree(db, conversationId, project.id);
  const ownCopy = worktree && !worktree.inPlace && (await isFolder(worktree.path));
  return {
    workspaceId,
    projectId: project.id,
    projectName: project.name,
    rootPath: project.root_path,
    preview: storedPreview(project.preview),
    folder: ownCopy ? worktree.path : project.root_path,
  };
}

export async function chatPreview(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<ChatPreview> {
  const place = await chatPreviewPlace(db, workspaceId, conversationId);
  if (!place) return { projectId: null, projectName: null, preview: null, server: null };
  const row = await previewRowAt(db, place.projectId, place.folder);
  return {
    projectId: place.projectId,
    projectName: place.projectName,
    preview: place.preview,
    server: row ? toPreviewServer(row) : null,
  };
}

export async function startPreview(
  db: Db,
  place: PreviewPlace,
  ask: PreviewAsk,
): Promise<PreviewRow> {
  if (!place.preview) throw new PreviewNotSetUpError();
  return askPreviewStart(db, place, ask);
}

export interface PreviewWait {
  timeoutMs: number;
  pollMs: number;
  signal?: AbortSignal | undefined;
}

export const PREVIEW_WAIT: PreviewWait = { timeoutMs: 75_000, pollMs: 250 };
const NUDGE_EVERY = 8;

export async function settledPreview(
  db: Queryable,
  id: string,
  wait: PreviewWait = PREVIEW_WAIT,
): Promise<PreviewRow | null> {
  const deadline = Date.now() + wait.timeoutMs;
  for (let polls = 1; ; polls += 1) {
    const row = await previewRow(db, id);
    if (!row || row.status !== 'starting' || Date.now() >= deadline) return row;
    if (wait.signal?.aborted) return row;
    if (polls % NUDGE_EVERY === 0) await nudgePreviews(db);
    await delay(wait.pollMs);
  }
}
