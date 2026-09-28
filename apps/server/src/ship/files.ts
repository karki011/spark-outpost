import type { ShipSkippedFile, TaskChanges } from '@spark-outpost/contracts';
import { isSecretPath } from '../projects/path-policy.ts';

export interface ShipCandidates {
  paths: string[];
  skipped: ShipSkippedFile[];
}

export const SECRET_SKIP_REASON = 'Looks like a secrets file, so Ship leaves it out.';

function outside(path: string): boolean {
  return path.startsWith('/') || path.split('/').includes('..');
}

export function shipCandidates(changes: TaskChanges): ShipCandidates {
  const seen = new Set<string>();
  for (const run of changes.runs) {
    if (run.revertedAt) continue;
    for (const file of run.files) {
      seen.add(file.path);
      if (file.oldPath) seen.add(file.oldPath);
    }
  }
  const paths: string[] = [];
  const skipped: ShipSkippedFile[] = [];
  for (const path of [...seen].sort()) {
    if (outside(path)) continue;
    if (isSecretPath(path)) skipped.push({ path, reason: SECRET_SKIP_REASON });
    else paths.push(path);
  }
  return { paths, skipped };
}
