import path from 'node:path';
import { attachmentContentPath, type StartTicketRequest } from '@spark-outpost/contracts';
import { AttachmentError } from '../persistence/attachment-content.ts';
import type { Queryable } from '../persistence/db.ts';
import { addTaskLink } from '../persistence/tasks.ts';
import { FolderError, realDirectory } from '../projects/folders.ts';
import { createProject } from '../projects/projects.ts';
import type { StartContext } from './request.ts';

export interface StartFile {
  id: string;
  name: string;
}

export interface ResolvedContext extends StartContext {
  attachments: readonly StartFile[];
}

const HIDDEN_FOLDER = "Spark doesn't reference hidden folders such as .git or .ssh.";

export async function realFolder(requested: string): Promise<string> {
  const real = await realDirectory(requested);
  if (real.split(path.sep).some((segment) => segment.startsWith('.'))) {
    throw new FolderError(HIDDEN_FOLDER);
  }
  return real;
}

async function startFiles(
  db: Queryable,
  workspaceId: string,
  request: Pick<StartTicketRequest, 'attachmentIds' | 'messageId'>,
): Promise<StartFile[]> {
  const ids = [...new Set(request.attachmentIds)];
  if (ids.length === 0) return [];
  const { rows } = await db.query<StartFile>(
    `SELECT id, name FROM attachments
     WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND (message_id IS NULL OR message_id = $3)`,
    [ids, workspaceId, request.messageId],
  );
  if (rows.length !== ids.length) {
    throw new AttachmentError(
      'An attachment is missing or already sent. Remove it and attach the file again.',
    );
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)!);
}

export async function resolveStartContext(
  db: Queryable,
  workspaceId: string,
  request: StartTicketRequest,
): Promise<ResolvedContext> {
  const folders = [...new Set(await Promise.all(request.folders.map(realFolder)))];
  const attachments = await startFiles(db, workspaceId, request);
  return {
    note: request.note,
    links: [...new Set(request.links)],
    files: attachments.map((file) => file.name),
    folders,
    attachments,
  };
}

function inside(root: string, folder: string): boolean {
  return folder === root || folder.startsWith(`${root}${path.sep}`);
}

export async function folderProjectIds(
  db: Queryable,
  workspaceId: string,
  folders: readonly string[],
): Promise<string[]> {
  if (folders.length === 0) return [];
  const { rows } = await db.query<{ id: string; root_path: string }>(
    'SELECT id, root_path FROM projects WHERE workspace_id = $1',
    [workspaceId],
  );
  const ids: string[] = [];
  for (const folder of folders) {
    const known = rows
      .filter((row) => inside(row.root_path, folder))
      .toSorted((a, b) => b.root_path.length - a.root_path.length)[0];
    ids.push(known ? known.id : (await createProject(db, workspaceId, folder)).project.id);
  }
  return [...new Set(ids)];
}

export async function saveContextLinks(
  db: Queryable,
  taskId: string,
  context: ResolvedContext,
): Promise<void> {
  for (const url of context.links) {
    await addTaskLink(db, taskId, { kind: 'link', url, title: null, source: 'user' });
  }
  for (const file of context.attachments) {
    const url = attachmentContentPath(file.id);
    await addTaskLink(db, taskId, { kind: 'file', url, title: file.name, source: 'user' });
  }
  for (const folder of context.folders) {
    const title = path.basename(folder);
    await addTaskLink(db, taskId, { kind: 'folder', url: folder, title, source: 'user' });
  }
}
