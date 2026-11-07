import path from 'node:path';
import type { ReposFolder } from '@spark-outpost/contracts';
import { browserDataDir } from '../approvals/browser-data.ts';
import type { Queryable } from '../persistence/db.ts';
import { isWithin } from './clone/clone-destination.ts';
import { FolderError, realDirectory } from './folders.ts';
import { displayPath, listProjects, realHome } from './projects.ts';

export interface ReposFolderRules {
  dataDir: string;
}

export function sparkReposRules(): ReposFolderRules {
  return { dataDir: browserDataDir() };
}

async function savedFolders(db: Queryable, workspaceId: string): Promise<string[]> {
  const { rows } = await db.query<{ repos_folders: string[] }>(
    'SELECT repos_folders FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows[0]?.repos_folders ?? [];
}

function outsideData(folder: string, rules: ReposFolderRules): boolean {
  return !isWithin(folder, rules.dataDir);
}

function distinct(folders: readonly string[]): string[] {
  return [...new Set(folders)];
}

export async function effectiveReposFolders(
  db: Queryable,
  workspaceId: string,
  rules: ReposFolderRules,
): Promise<ReposFolder[]> {
  const home = await realHome();
  const saved = await savedFolders(db, workspaceId);
  const suggested = saved.length === 0;
  const folders = suggested
    ? distinct(
        (await listProjects(db, workspaceId)).map((project) => path.dirname(project.rootPath)),
      )
    : saved;
  return folders
    .filter((folder) => outsideData(folder, rules))
    .map((folder) => ({ path: folder, displayPath: displayPath(folder, home), suggested }));
}

async function checkedFolder(requested: string, rules: ReposFolderRules): Promise<string> {
  const folder = await realDirectory(requested);
  if (folder === path.parse(folder).root) {
    throw new FolderError('Choose a folder, not your whole disk.');
  }
  if (!outsideData(folder, rules)) {
    throw new FolderError('Spark keeps its own files there. Choose another folder.');
  }
  return folder;
}

export async function saveReposFolders(
  db: Queryable,
  workspaceId: string,
  requested: readonly string[],
  rules: ReposFolderRules,
): Promise<ReposFolder[]> {
  const folders: string[] = [];
  for (const folder of requested) folders.push(await checkedFolder(folder, rules));
  await db.query(
    `INSERT INTO profiles (workspace_id, repos_folders) VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET repos_folders = EXCLUDED.repos_folders`,
    [workspaceId, distinct(folders)],
  );
  return effectiveReposFolders(db, workspaceId, rules);
}
