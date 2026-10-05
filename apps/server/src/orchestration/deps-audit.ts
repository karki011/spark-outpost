import path from 'node:path';
import { insertProtocolEntries } from '../persistence/audit-log.ts';
import type { Db } from '../persistence/db.ts';
import type { Lease } from '../persistence/jobs.ts';
import type { DepsPrep } from '../projects/worktree-deps.ts';

export function installingNote(command: string): string {
  return `Installing dependencies in this chat’s copy, because its lockfile differs from your checkout: \`${command}\`.`;
}

export function depsNote(prep: DepsPrep | null): string | null {
  if (!prep) return null;
  if (prep.stale) return prep.note;
  if (prep.method !== 'install') return null;
  return `Dependencies were installed to match this copy’s lockfile (${Math.round(prep.durationMs / 1000)} s).`;
}

export async function auditDepsPrep(
  db: Db,
  lease: Lease,
  prep: DepsPrep,
  copy: string,
): Promise<void> {
  const payload = {
    copy: path.basename(copy),
    method: prep.method,
    lockfileMatched: prep.lockfileMatched,
    outcome: prep.stale ? 'out_of_date' : prep.method === 'skipped' ? 'skipped' : 'prepared',
    durationMs: prep.durationMs,
    note: prep.note,
  };
  await insertProtocolEntries(db, lease, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'check',
      method: 'deps/prepare',
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: false,
      payload,
    },
  ]);
}
