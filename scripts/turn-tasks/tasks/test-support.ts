import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshCopy, type ScratchRepo } from '../scratch-repo/create.ts';
import type { ApprovalFact, Evidence } from './types.ts';

export interface TestBench {
  base: string;
  copy(name: string): Promise<ScratchRepo>;
  remove(): Promise<void>;
}

export async function testBench(): Promise<TestBench> {
  const base = await mkdtemp(join(await realpath(tmpdir()), 'spark-turn-tasks-test-'));
  return {
    base,
    copy: (name) => freshCopy(name, base),
    remove: () => rm(base, { recursive: true, force: true }),
  };
}

export function evidenceFor(repo: ScratchRepo, extra: Partial<Evidence> = {}): Evidence {
  return {
    repo: repo.path,
    baseCommit: repo.commit,
    reply: '',
    toolchain: repo.toolchain,
    audit: { approvals: [], railFlags: [], unreviewed: 0 },
    home: join(repo.path, '..', 'home'),
    ...extra,
  };
}

export function approval(text: string, status: string, decidedBy: string | null): ApprovalFact {
  return {
    runId: 'run-1',
    toolCallId: 'call-1',
    kind: 'execute',
    title: text,
    text,
    status,
    decidedBy,
  };
}

export async function replaceIn(
  repo: ScratchRepo,
  path: string,
  from: string | RegExp,
  to: string,
): Promise<void> {
  const file = join(repo.path, path);
  const before = await readFile(file, 'utf8');
  const after = before.replace(from, to);
  if (after === before) throw new Error(`Nothing to replace in ${path}.`);
  await writeFile(file, after);
}
