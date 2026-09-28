import { approvedEveryEdit } from '../persistence/approvals.ts';
import { runChanges } from '../projects/run-changes.ts';
import { confirmsRiskyFirst } from './checkpoint-policy.ts';
import { checksFailing } from './full-auto-ship.ts';
import { changesSoFar } from './member-prompts.ts';
import { destructiveMigrationInPatch } from './risk-rules.ts';
import type { Session } from './session.ts';
import type { FlowEvent } from './transitions.ts';

async function unconfirmedRiskyMigration(s: Session): Promise<string | null> {
  const confirmed = s.risky && confirmsRiskyFirst(s.input.level);
  if (confirmed || s.input.mode !== 'do' || s.flow.readOnly) return null;
  const { patch } = await changesSoFar(s).catch(() => ({ patch: '' }));
  const statement = patch ? destructiveMigrationInPatch(patch) : null;
  if (statement) s.risky = `The change adds a destructive migration: ${statement}`;
  return statement;
}

export async function wrappedUp(s: Session): Promise<FlowEvent> {
  const changes = await runChanges(s.deps.db, s.input.workspaceId, s.lease.runId, true).catch(
    () => null,
  );
  const riskyMigration = await unconfirmedRiskyMigration(s);
  const files = changes?.files.map((file) => file.path) ?? [];
  const approvedEach = await approvedEveryEdit(s.deps.db, s.lease.runId, files);
  return {
    type: 'wrapped',
    filesChanged: files.length,
    ...(checksFailing(s) ? { checksFailing: true } : {}),
    ...(riskyMigration ? { riskyMigration } : {}),
    ...(approvedEach ? { approvedEach: true } : {}),
  };
}
