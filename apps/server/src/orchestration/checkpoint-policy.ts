import { type InvolvementLevel } from '@spark-outpost/contracts';
import type { FlowState } from './flow-types.ts';
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

export interface KeepFacts {
  checksFailing: boolean;
  criticUnsatisfied: boolean;
  riskyMigration?: string | null;
  outsideWorktree?: boolean;
  criticSkipped?: boolean;
}

const SETTLED: KeepFacts = { checksFailing: false, criticUnsatisfied: false };

export function asksToKeep(
  level: InvolvementLevel,
  filesChanged: number,
  facts: KeepFacts = SETTLED,
): boolean {
  if (filesChanged === 0) return false;
  if (level !== 'hands-off') return false;
  return Boolean(facts.riskyMigration) && facts.outsideWorktree === true;
}

export function keepsByItself(level: InvolvementLevel, filesChanged: number): boolean {
  return level === 'hands-off' && filesChanged > 0;
}

export function keepReason(level: InvolvementLevel, facts: KeepFacts): string | null {
  if (level !== 'hands-off' || !facts.riskyMigration) return null;
  return `Automatic asks because ${riskyMigrationReason(facts.riskyMigration)} and the change is in your checkout, not a worktree.`;
}

export const KEPT_BY_AUTO_EDIT =
  'Kept automatically: the checks pass and the Critic, if it ran, found no correctness problems. Revert undoes them.';

function keptConcerns(facts: KeepFacts): string[] {
  return [
    facts.checksFailing ? 'the checks still fail' : null,
    facts.criticUnsatisfied ? 'the Critic still has concerns' : null,
    facts.criticSkipped ? 'the Critic was unavailable, so no AI review ran' : null,
    facts.riskyMigration ? riskyMigrationReason(facts.riskyMigration) : null,
  ].filter((part): part is string => part !== null);
}

export function keptLine(facts: KeepFacts): string | null {
  const concerns = keptConcerns(facts);
  if (concerns.length === 0) return null;
  return `Kept automatically; worth a look: ${concerns.join('; ')}. Revert undoes them.`;
}

export function shipsByItself(level: InvolvementLevel, filesChanged: number): boolean {
  return level === 'full-auto' && filesChanged > 0;
}

export function keepFacts(
  state: FlowState,
  checksFailing: boolean,
  riskyMigration: string | null = null,
): KeepFacts {
  const critic = state.verdict !== null;
  return {
    checksFailing,
    criticUnsatisfied: critic && (state.verdict === 'unclear' || state.review.fixable.length > 0),
    ...(riskyMigration ? { riskyMigration } : {}),
    ...(state.criticSkipped ? { criticSkipped: true } : {}),
  };
}

export function filesChangedLine(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'} changed.`;
}
