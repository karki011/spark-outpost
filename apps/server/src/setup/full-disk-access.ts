import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FullDiskAccessStatus } from '@spark-outpost/contracts';

export type ReadDirFn = (target: string) => Promise<unknown>;

function protectedFolders(home: string): string[] {
  return [
    path.join(home, 'Library', 'Safari'),
    path.join(home, 'Library', 'Mail'),
    path.join(home, 'Library', 'Application Support', 'com.apple.TCC'),
  ];
}

export async function fullDiskAccessStatus(
  platform: NodeJS.Platform = process.platform,
  readDir: ReadDirFn = readdir,
  home: string = os.homedir(),
): Promise<FullDiskAccessStatus> {
  if (platform !== 'darwin') return { status: 'unsupported' };

  let sawExisting = false;
  for (const folder of protectedFolders(home)) {
    try {
      await readDir(folder);
      return { status: 'granted' };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') sawExisting = true;
    }
  }
  return { status: sawExisting ? 'not_granted' : 'unknown' };
}
