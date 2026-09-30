import {
  CHECKPOINT_OPTION,
  type CheckpointKind,
  type InvolvementLevel,
} from '@spark-outpost/contracts';
import { asksWhenUnsure } from '../advisor/gate.ts';
import { destructiveMigrationWording } from './risk-rules.ts';

export const DESTRUCTIVE_CARD_REASON =
  'This change looks destructive: it can delete or rewrite data, files or history. The Builder works in a worktree copy on the top-tier model, and the Critic reviews the change before it lands.';
export const MIGRATION_CARD_REASON =
  'This migration can rename, drop or rewrite what existing data depends on. The Critic reviews the change when the Builder is done.';
export const RISKY_PR_NOTE =
  'Risky change: destructive or a schema migration. Review it carefully before merging.';

export function riskyChange(destructive: boolean, request: string): string | null {
  if (destructive) return DESTRUCTIVE_CARD_REASON;
  if (destructiveMigrationWording(request)) return MIGRATION_CARD_REASON;
  return null;
}

function riskyMigrationReason(statement: string): string {
  const shown = statement.length > 120 ? `${statement.slice(0, 120)}…` : statement;
  return `the migration it added can lose or rewrite existing data (\`${shown}\`)`;
}

export function confirmsRiskyFirst(level: InvolvementLevel): boolean {
  return level === 'balanced';
}

export function autoInWorktree(level: InvolvementLevel, inChatWorktree: boolean): boolean {
  return inChatWorktree && level !== 'balanced';
}

export function autoInAsk(level: InvolvementLevel): boolean {
  return level !== 'balanced';
}

export function copiesRiskyWork(level: InvolvementLevel): boolean {
  return level !== 'balanced';
}

export interface KeepFacts {
  checksFailing: boolean;
  criticUnsatisfied: boolean;
  riskyMigration?: string | null;
  approvedEach?: boolean;
}

const SETTLED: KeepFacts = { checksFailing: false, criticUnsatisfied: false };

export function asksToKeep(
  level: InvolvementLevel,
  filesChanged: number,
  facts: KeepFacts = SETTLED,
): boolean {
  if (filesChanged === 0) return false;
  const troubled = facts.checksFailing || facts.criticUnsatisfied || Boolean(facts.riskyMigration);
  if (level === 'balanced') return !facts.approvedEach || troubled;
  if (level === 'hands-off') return troubled;
  return false;
}

export function keepsByItself(
  level: InvolvementLevel,
  filesChanged: number,
  facts: KeepFacts = SETTLED,
): boolean {
  if (filesChanged === 0) return false;
  return level === 'hands-off' || (level === 'balanced' && facts.approvedEach === true);
}

export function keepReason(level: InvolvementLevel, facts: KeepFacts): string | null {
  if (level !== 'hands-off') return null;
  if (facts.checksFailing) return 'Automatic asks because the checks still fail.';
  if (facts.criticUnsatisfied) return 'Automatic asks because the Critic still has concerns.';
  if (facts.riskyMigration)
    return `Automatic asks because ${riskyMigrationReason(facts.riskyMigration)}.`;
  return null;
}

export const KEPT_BY_AUTO_EDIT =
  'Kept automatically: the checks pass and the Critic, if it ran, found no correctness problems. Revert undoes them.';

export const KEPT_AFTER_EACH_EDIT =
  'Kept: you approved every edit as it happened, so there was nothing new to ask. Revert undoes them.';

export function fixesFindingsItself(level: InvolvementLevel): boolean {
  return level !== 'balanced';
}

export function shipsByItself(level: InvolvementLevel, filesChanged: number): boolean {
  return level === 'full-auto' && filesChanged > 0;
}

export function asksForLoop(level: InvolvementLevel): boolean {
  return asksWhenUnsure(level);
}

export function autoContinueOption(kind: CheckpointKind, interpret: boolean): string | null {
  if (kind === 'clarify' && interpret) return CHECKPOINT_OPTION.clarifyRules;
  if (kind === 'retry') return CHECKPOINT_OPTION.stopReport;
  if (kind === 'stuck') return CHECKPOINT_OPTION.stopReport;
  if (kind === 'verify') return CHECKPOINT_OPTION.finishUnverified;
  return null;
}
