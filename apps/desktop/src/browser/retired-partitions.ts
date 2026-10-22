import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const RETIRED_FOLDER =
  /^spark-browser-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRetiredPartitionFolder(name: string): boolean {
  return RETIRED_FOLDER.test(name);
}

export async function removeRetiredPartitions(
  userData: string,
  log: (line: string) => void,
): Promise<void> {
  const folder = path.join(userData, 'Partitions');
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return;
  }
  for (const name of names.filter(isRetiredPartitionFolder)) {
    try {
      await rm(path.join(folder, name), { recursive: true, force: true });
      log('Removed a per-project Browser pane profile that one shared profile replaced.');
    } catch {
      log('Could not remove a per-project Browser pane profile.');
    }
  }
}
