import { gitDiffSince } from '../projects/snapshot.ts';
import { getSnapshot } from '../persistence/run-snapshots.ts';
import { builderPrompt, criticPrompt, type ChangedFile } from './context.ts';
import type { Session } from './session.ts';
import type { Spawn } from './transitions.ts';

export interface ChangeSummary {
  files: ChangedFile[];
  patch: string;
}

export async function changesSoFar(s: Session): Promise<ChangeSummary> {
  const state = await getSnapshot(s.deps.db, s.input.workspaceId, s.lease.runId);
  const snapshot = state?.snapshot;
  if (!snapshot || snapshot.kind !== 'git' || !snapshot.ref) return { files: [], patch: '' };
  const diff = await gitDiffSince(snapshot.root, snapshot.ref).catch(() => null);
  return diff ? { files: diff.stats, patch: diff.patch } : { files: [], patch: '' };
}

export function checkCommands(s: Session): string[] {
  return s.checks?.commands.map((check) => check.command) ?? [];
}

export async function promptFor(s: Session, spawn: Spawn): Promise<string> {
  const request = s.input.userRequest;
  if (spawn.role === 'critic') {
    const changes = await changesSoFar(s);
    return criticPrompt({
      request,
      plan: s.plan.map((entry) => entry.content),
      changes: changes.files,
      patch: changes.patch,
      checks: s.checkLines,
      buildStyle: s.buildStyle,
    });
  }
  return builderPrompt({
    request,
    history: s.input.history,
    note: spawn.note,
    findings: [],
    buildStyle: s.buildStyle,
    checkCommands: checkCommands(s),
  });
}
