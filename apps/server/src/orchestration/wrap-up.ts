import { approvedEveryEdit } from '../persistence/approvals.ts';
import { runChanges } from '../projects/run-changes.ts';
import { checksFailing } from './check-results.ts';
import { confirmsRiskyFirst } from './checkpoint-policy.ts';
import { agreedPlanText, changesSoFar } from './member-prompts.ts';
import { recordLaws, reviewLaws } from '../laws/review.ts';
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

async function settleLaws(s: Session): Promise<void> {
  if (s.input.mode !== 'do' || s.flow.readOnly || s.flow.solo) return;
  const { patch } = await changesSoFar(s);
  if (!patch.trim()) return;
  s.laws = reviewLaws(s, patch, await agreedPlanText(s));
  await recordLaws(s, s.laws);
}

export async function wrappedUp(s: Session): Promise<FlowEvent> {
  await settleLaws(s).catch((error: unknown) => console.error('Could not review the laws', error));
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
    ...(s.input.chatWorktree ? {} : { outsideWorktree: true }),
  };
}
