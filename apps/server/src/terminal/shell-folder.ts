import { stat } from 'node:fs/promises';
import os from 'node:os';
import type { ShellFolderKind } from '@spark-outpost/contracts';
import { liveChatWorktree } from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';

export interface ShellFolder {
  cwd: string;
  label: string;
  kind: ShellFolderKind;
  note: string | null;
}

interface PrimaryProject {
  id: string;
  name: string;
  root_path: string;
}

async function isFolder(target: string): Promise<boolean> {
  return stat(target).then(
    (info) => info.isDirectory(),
    () => false,
  );
}

async function primaryProject(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<PrimaryProject | null> {
  const { rows } = await db.query<PrimaryProject>(
    `SELECT p.id, p.name, p.root_path FROM conversations c
     JOIN conversation_projects cp ON cp.conversation_id = c.id
     JOIN projects p ON p.id = cp.project_id
     WHERE c.id = $1 AND c.workspace_id = $2
     ORDER BY cp.position, cp.created_at LIMIT 1`,
    [conversationId, workspaceId],
  );
  return rows[0] ?? null;
}

function homeFolder(home: string, note: string | null = null): ShellFolder {
  return { cwd: home, label: '~', kind: 'home', note };
}

export async function shellFolder(
  db: Queryable,
  workspaceId: string,
  conversationId: string | null,
  home: string = os.homedir(),
): Promise<ShellFolder> {
  if (!conversationId) return homeFolder(home);
  const project = await primaryProject(db, workspaceId, conversationId);
  if (!project) return homeFolder(home);

  let note: string | null = null;
  const worktree = await liveChatWorktree(db, conversationId, project.id);
  if (worktree && !worktree.inPlace) {
    if (await isFolder(worktree.path)) {
      return {
        cwd: worktree.path,
        label: `${worktree.branch} · worktree`,
        kind: 'worktree',
        note: null,
      };
    }
    note = `This chat’s worktree for ${worktree.branch} was removed, so the terminal opened in ${project.name}.`;
  }
  if (await isFolder(project.root_path)) {
    return { cwd: project.root_path, label: `my files · ${project.name}`, kind: 'project', note };
  }
  return homeFolder(
    home,
    `${project.name} isn’t at ${project.root_path} any more, so the terminal opened in your home folder.`,
  );
}
