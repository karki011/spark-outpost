import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BROWSER_PARTITION, PERSONAL_PARTITION } from './request-guard.ts';
import { isRetiredPartitionFolder, removeRetiredPartitions } from './retired-partitions.ts';

const PROJECT = '01a160e7-bb54-7772-8dc9-352d68295d36';
const temps: string[] = [];

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('retired per-project Browser pane profiles', () => {
  it('matches only a per-project folder, never the shared profile', () => {
    expect(isRetiredPartitionFolder(`spark-browser-${PROJECT}`)).toBe(true);
    expect(isRetiredPartitionFolder(BROWSER_PARTITION.replace('persist:', ''))).toBe(false);
    expect(isRetiredPartitionFolder(PERSONAL_PARTITION.replace('persist:', ''))).toBe(false);
    expect(isRetiredPartitionFolder('spark-browser-devtools')).toBe(false);
    expect(isRetiredPartitionFolder(`spark-browser-${PROJECT}-x`)).toBe(false);
    expect(isRetiredPartitionFolder(`other-${PROJECT}`)).toBe(false);
    expect(isRetiredPartitionFolder('..')).toBe(false);
  });

  it('removes the per-project folders and keeps everything else', async () => {
    const userData = await mkdtemp(path.join(os.tmpdir(), 'spark-partitions-'));
    temps.push(userData);
    const partitions = path.join(userData, 'Partitions');
    const kept = ['other', 'spark-browser-personal', 'spark-browser-profile'];
    for (const name of [`spark-browser-${PROJECT}`, ...kept]) {
      await mkdir(path.join(partitions, name, 'Cookies-dir'), { recursive: true });
      await writeFile(path.join(partitions, name, 'Cookies'), 'x');
    }
    const lines: string[] = [];
    await removeRetiredPartitions(userData, (line) => lines.push(line));
    expect((await readdir(partitions)).sort()).toEqual(kept);
    expect(lines).toHaveLength(1);
  });

  it('does nothing when there is no Partitions folder', async () => {
    const userData = await mkdtemp(path.join(os.tmpdir(), 'spark-partitions-'));
    temps.push(userData);
    await expect(removeRetiredPartitions(userData, () => {})).resolves.toBeUndefined();
  });
});
