import { realpathSync } from 'node:fs';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { CloneJob } from '@spark-outpost/contracts';
import type { CloneJobs } from '../projects/clone/clone-jobs.ts';
import { chatHome } from './folders.ts';

export function chatResearchBase(channel: string, temp = realpathSync(tmpdir())): string {
  return join(temp, 'spark-outpost-research', channel);
}

export function researchCopyFolder(base: string, conversationId: string, slug: string): string {
  const [owner = '', repo = ''] = slug.split('/');
  return join(chatHome(base, conversationId), owner, repo);
}

const readyMark = (folder: string) => `${folder}.ready`;

async function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}

export async function readyResearchCopy(
  base: string,
  conversationId: string,
  slug: string,
): Promise<string | null> {
  const folder = researchCopyFolder(base, conversationId, slug);
  const [marked, cloned] = await Promise.all([
    exists(readyMark(folder)),
    exists(join(folder, '.git', 'HEAD')),
  ]);
  return marked && cloned ? folder : null;
}

export async function researchCopySettled(
  clones: CloneJobs,
  job: CloneJob,
): Promise<CloneJob | null> {
  const settled = await clones.settled(job.id);
  if (settled?.status === 'done') await writeFile(readyMark(job.destination), '');
  return settled;
}

export async function startResearchCopy(
  clones: CloneJobs,
  base: string,
  conversationId: string,
  slug: string,
  url: string,
): Promise<CloneJob> {
  const folder = researchCopyFolder(base, conversationId, slug);
  const running = clones
    .list()
    .find((job) => job.destination === folder && job.status === 'cloning');
  if (running) return running;
  await rm(readyMark(folder), { force: true });
  await rm(folder, { recursive: true, force: true });
  await mkdir(base, { recursive: true, mode: 0o700 });
  await mkdir(dirname(folder), { recursive: true, mode: 0o700 });
  const request = { url, parentPath: dirname(folder), name: basename(folder) };
  const { job, started } = await clones.start(request, { destination: folder });
  if (started) {
    void researchCopySettled(clones, job).catch((error: unknown) => console.error(error));
  }
  return job;
}
