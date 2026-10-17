import type { Queryable } from '../persistence/db.ts';
import {
  markRevertsNoted,
  unnotedReverts,
  type UnnotedRevert,
} from '../persistence/file-reverts.ts';
import { startsWithCommand, withAgentNote } from './agent-note.ts';
import type { RunInput } from './run-input.ts';

export function revertNote(reverts: readonly Pick<UnnotedRevert, 'runNumber' | 'path'>[]): string {
  const byRun = new Map<number, string[]>();
  for (const revert of reverts) {
    byRun.set(revert.runNumber, [...(byRun.get(revert.runNumber) ?? []), revert.path]);
  }
  const lines = [...byRun].map(
    ([runNumber, paths]) =>
      `The user reverted these files to how they were before run ${runNumber}: ${paths.join(', ')}.`,
  );
  return `${lines.join('\n')}\nRe-read them before editing.`;
}

export async function noteRevertedFiles(db: Queryable, input: RunInput): Promise<RunInput> {
  if (input.parentRunId !== null || startsWithCommand(input)) return input;
  const reverts = await unnotedReverts(db, input.identity.threadId);
  if (reverts.length === 0) return input;
  await markRevertsNoted(db, reverts);
  return withAgentNote(input, revertNote(reverts));
}
