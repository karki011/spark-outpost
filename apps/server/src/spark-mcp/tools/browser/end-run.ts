import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SparkScope, SparkToolDeps } from '../../deps.ts';

export function runShotDir(deps: Pick<SparkToolDeps, 'shotDir'>, runId: string): string {
  return path.join(deps.shotDir ?? path.join(os.tmpdir(), 'spark-outpost-browser'), runId);
}

export async function endBrowserRun(deps: SparkToolDeps, scope: SparkScope): Promise<void> {
  if (!deps.browser || !scope.conversationId || !scope.runId) return;
  await rm(runShotDir(deps, scope.runId), { recursive: true, force: true }).catch(() => undefined);
  await deps.browser
    .request({ op: 'end_run', chatId: scope.conversationId, runId: scope.runId })
    .catch(() => undefined);
}
