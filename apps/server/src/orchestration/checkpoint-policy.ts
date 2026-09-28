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

/**
 * Why a change is risky enough for a card before the Builder, or null. Destructive work asks;
 * a migration asks only when its wording drops, renames, retypes or rewrites existing data.
 * Additive migrations (a new table, a nullable column, an index) don't; they still get the
 * Critic. Once the Builder has written the migration, `riskyMigrationReason` reads its diff.
 */
export function riskyChange(destructive: boolean, request: string): string | null {
  if (destructive) return DESTRUCTIVE_CARD_REASON;
  if (destructiveMigrationWording(request)) return MIGRATION_CARD_REASON;
  return null;
}

/** Why the migration the change adds is destructive, from its diff. */
export function riskyMigrationReason(statement: string): string {
  const shown = statement.length > 120 ? `${statement.slice(0, 120)}…` : statement;
  return `the migration it added can lose or rewrite existing data (\`${shown}\`)`;
}

/**
 * Review each step shows a card before the first Builder starts on risky work. Automatic and
 * Full auto go ahead in a worktree copy instead; Full auto also flags the change in the PR body.
 */
export function confirmsRiskyFirst(level: InvolvementLevel): boolean {
  return level === 'balanced';
}

export function copiesRiskyWork(level: InvolvementLevel): boolean {
  return level !== 'balanced';
}

export interface KeepFacts {
  /** The latest project checks still fail. */
  checksFailing: boolean;
  /** The Critic ran and is not satisfied: correctness findings left, or no clear verdict. */
  criticUnsatisfied: boolean;
  /** The diff adds a destructive migration nobody confirmed before the Builder started. */
  riskyMigration?: string | null;
  approvedEach?: boolean;
}

const SETTLED: KeepFacts = { checksFailing: false, criticUnsatisfied: false };

/**
 * Review each step always asks to keep changed files, unless you already approved every edit
 * (see `approvedEveryEdit`). Automatic asks only when something is wrong (checks fail, the
 * Critic still has concerns, or an unconfirmed destructive migration); otherwise it keeps them
 * by itself, with Revert still there. Full auto → PR keeps and ships (see shipsByItself).
 */
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
