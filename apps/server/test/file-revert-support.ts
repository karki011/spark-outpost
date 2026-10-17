import { execFileSync } from 'node:child_process';
import { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import type { FileRevertCheck } from '@spark-outpost/contracts';
import { buildChangeSet, type ChangeSet } from '../src/projects/change-sets.ts';
import { fileRevertCheck, revertFile } from '../src/projects/file-revert.ts';
import { taskChangeSet } from '../src/projects/task-changes.ts';
import type { Provider, ProviderOutput } from '../src/providers/provider.ts';
import type { TestDb } from './support.ts';
import { driveToEnd, sendMessage } from './turn-support.ts';

export interface Ops {
  write?: Record<string, string | Buffer>;
  remove?: string[];
  move?: [string, string][];
  link?: Record<string, string>;
}

async function apply(root: string, ops: Ops): Promise<void> {
  for (const [name, content] of Object.entries(ops.write ?? {})) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  for (const name of ops.remove ?? []) await rm(path.join(root, name));
  for (const [from, to] of ops.move ?? []) {
    await rename(path.join(root, from), path.join(root, to));
  }
  for (const [name, target] of Object.entries(ops.link ?? {})) {
    await symlink(target, path.join(root, name));
  }
}

export function scriptedAgent(queue: Ops[]): Provider {
  return {
    name: 'claude',
    async *run(turn) {
      const root = turn.projectRoots?.[0] ?? '';
      const ops = queue.shift() ?? {};
      const touched = [
        ...Object.keys(ops.write ?? {}),
        ...(ops.remove ?? []),
        ...(ops.move ?? []).flat(),
        ...Object.keys(ops.link ?? {}),
      ];
      for (const name of touched) {
        const seen: ProviderOutput = {
          kind: 'file_focus',
          path: path.join(root, name),
          line: null,
          limit: null,
          action: 'edit',
        };
        turn.observe?.(seen);
        yield seen;
      }
      const step = { name: 'Edit files', tool: true, toolKind: 'edit' };
      const started: ProviderOutput = { kind: 'step_started', ...step };
      turn.observe?.(started);
      yield started;
      await apply(root, ops);
      yield { kind: 'step_finished', ...step };
      yield { kind: 'text_delta', delta: 'Done.' };
    },
  };
}

export async function runTurn(t: TestDb, conversationId: string): Promise<string> {
  const runId = await sendMessage(t, conversationId, 'Make the change.', {
    permission: 'do',
    agentMode: 'bypassPermissions',
  });
  const { run } = await driveToEnd(t, conversationId, runId);
  expect(run.status).toBe('succeeded');
  return runId;
}

export async function runFacts(t: TestDb, runId: string) {
  const { rows } = await t.db.query<{ task_id: string; snapshot_root: string }>(
    'SELECT task_id, snapshot_root FROM runs WHERE id = $1',
    [runId],
  );
  return { taskId: rows[0]!.task_id, root: rows[0]!.snapshot_root };
}

export async function changeSet(t: TestDb, taskId: string): Promise<ChangeSet> {
  return buildChangeSet(taskId, await taskChangeSet(t.db, t.workspaceId, taskId), Date.now());
}

export async function listedPaths(t: TestDb, taskId: string): Promise<string[]> {
  return (await changeSet(t, taskId)).entries.map((entry) => entry.listed.file.path);
}

export async function check(
  t: TestDb,
  taskId: string,
  runId: string,
  file: string,
): Promise<FileRevertCheck> {
  return fileRevertCheck(t.db, t.workspaceId, await changeSet(t, taskId), runId, file);
}

export async function revert(t: TestDb, taskId: string, runId: string, file: string) {
  return revertFile(t.db, t.workspaceId, await changeSet(t, taskId), runId, file);
}

export function gitIn(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}
