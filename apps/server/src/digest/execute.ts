import type { Lease } from '../persistence/jobs.ts';
import { digestChatIds, digestStatsByRun, finishDigest } from '../persistence/digests.ts';
import { executeChildRun, type ExecuteRunDeps } from '../workflow/execute-run.ts';
import { parseDigestReply } from './parse.ts';

const FAILED = 'The digest could not be written. Try again.';

export async function executeDigest(deps: ExecuteRunDeps, lease: Lease): Promise<void> {
  const result = await executeChildRun(deps, lease);
  if (result.outcome === 'lease_lost') return;
  if (result.outcome !== 'succeeded') {
    await finishDigest(deps.db, lease.runId, { error: result.error ?? FAILED });
    return;
  }
  const [chatIds, stats] = await Promise.all([
    digestChatIds(deps.db, lease.runId),
    digestStatsByRun(deps.db, lease.runId),
  ]);
  await finishDigest(deps.db, lease.runId, {
    body: parseDigestReply(result.text, chatIds, stats),
  });
}
