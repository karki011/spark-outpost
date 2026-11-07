import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';

export type FileBefore = Buffer | null | 'not-a-file';

const WITHOUT_WAITING = constants.O_RDONLY | constants.O_NONBLOCK;

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export async function readBefore(target: string): Promise<FileBefore> {
  let handle;
  try {
    handle = await open(target, WITHOUT_WAITING);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  try {
    if (!(await handle.stat()).isFile()) return 'not-a-file';
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export function readBeforeNow(target: string, limit: number): FileBefore | 'too-large' {
  let fd: number;
  try {
    fd = openSync(target, WITHOUT_WAITING);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return 'not-a-file';
    if (stat.size > limit) return 'too-large';
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}
