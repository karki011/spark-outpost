import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { OUTSIDE_FOLDER_REASON } from '../../approvals/spark-command.ts';

export const NO_SUCH_FOLDER_REASON = 'That folder does not exist in this chat';

interface Root {
  path: string;
}

export function resolveFolder(roots: readonly Root[], cwd: string | undefined): string | null {
  const home = roots[0]?.path ?? null;
  if (cwd === undefined) return home;
  if (path.isAbsolute(cwd)) return path.resolve(cwd);
  return home === null ? null : path.resolve(home, cwd);
}

function holds(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function isFolder(folder: string): Promise<boolean> {
  return stat(folder).then(
    (found) => found.isDirectory(),
    () => false,
  );
}

async function realRoots(roots: readonly Root[]): Promise<string[]> {
  const found = await Promise.all(
    roots.map((root) => realpath(root.path).then(String, () => null)),
  );
  return found.flatMap((root) => root ?? []);
}

export async function folderProblem(
  roots: readonly Root[],
  folder: string,
): Promise<string | null> {
  if (!(await isFolder(folder))) return NO_SUCH_FOLDER_REASON;
  const real = await realpath(folder);
  const inside = (await realRoots(roots)).some((root) => holds(root, real));
  return inside ? null : OUTSIDE_FOLDER_REASON;
}
