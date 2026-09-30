import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { InvolvementLevel, PieceList } from '@spark-outpost/contracts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { currentPieceList } from '../src/persistence/pieces.ts';
import { createProject } from '../src/projects/projects.ts';
import { PIECE_CHECK_SCRIPT } from './fake-acp-coordinator.ts';
import {
  NORMAL,
  jevFetch,
  startOrchestrator,
  startScenario,
  withTag,
  type Harness,
} from './orchestration-support.ts';
import type { TestDb } from './support.ts';

export interface PieceRun {
  id: string;
  role: string;
  name: string;
  pieceKey: string | null;
  resumeKey: string | null;
  slot: string | null;
  worktreeRun: string | null;
  prompt: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export async function pieceRepo(root: string): Promise<void> {
  await writeFile(join(root, 'piece-check.mjs'), PIECE_CHECK_SCRIPT);
  await mkdir(join(root, 'migrations'), { recursive: true });
  await writeFile(join(root, 'migrations', '0001_init.sql'), '-- init\n');
}

export async function projectFlags(
  t: TestDb,
  root: string,
  flags: { parallel?: boolean; stableCheckout?: boolean; slots?: number },
): Promise<void> {
  const { project } = await createProject(t.db, t.workspaceId, root);
  await t.db.query(
    `UPDATE projects SET parallel_pieces = $2, stable_checkout = $3, piece_slots = $4
     WHERE id = $1`,
    [project.id, flags.parallel ?? true, flags.stableCheckout ?? false, flags.slots ?? 3],
  );
}

export async function crewRuns(t: TestDb, runId: string): Promise<PieceRun[]> {
  const { rows } = await t.db.query<{
    id: string;
    role: string;
    route: Record<string, unknown>;
    prompt: string;
    status: string;
    started_at: Date | null;
    finished_at: Date | null;
  }>(
    `SELECT id, role, route, prompt, status, started_at, finished_at FROM runs
     WHERE parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  return rows.map((row) => {
    const env = row.route.builderEnv as Record<string, string> | undefined;
    return {
      id: row.id,
      role: row.role,
      name: String(row.route.name ?? ''),
      pieceKey: (row.route.pieceKey as string | undefined) ?? null,
      resumeKey: (row.route.resumeKey as string | undefined) ?? null,
      slot: env?.SPARK_BUILDER_SLOT ?? null,
      worktreeRun: (row.route.worktreeRun as string | undefined) ?? null,
      prompt: row.prompt,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  });
}

export function overlap(a: PieceRun, b: PieceRun): boolean {
  if (!a.startedAt || !b.startedAt || !a.finishedAt || !b.finishedAt) return false;
  return a.startedAt < b.finishedAt && b.startedAt < a.finishedAt;
}

export async function pieceListOf(t: TestDb, runId: string): Promise<PieceList> {
  const view = await loadOrchestration(t.db, runId);
  return (await currentPieceList(t.db, view!.taskId!))!;
}

export function beginPieces(
  t: TestDb,
  root: string,
  tags: string,
  options: { level?: InvolvementLevel; costCapUsd?: number } = {},
): { harness: Harness; started: ReturnType<typeof startScenario> } {
  const harness = startOrchestrator(t, jevFetch({ calls: [], scenario: NORMAL }), {
    coordinator: 'parallel',
    ...(options.costCapUsd === undefined ? {} : { budget: { costCapUsd: options.costCapUsd } }),
  });
  const scenario = withTag(NORMAL, `Split this up. #pieces #parallel ${tags}`);
  const started = startScenario(
    t,
    root,
    scenario,
    options.level ?? 'hands-off',
    'auto',
    'sonnet',
    'acceptEdits',
  );
  return { harness, started };
}
