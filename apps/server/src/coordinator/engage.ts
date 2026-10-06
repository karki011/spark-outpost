import {
  BROAD_SCAN_SCORE,
  COORD_ENGAGE_PLAN_AREAS,
  COORD_ENGAGE_PLAN_ITEMS,
  COORD_ENGAGE_SCAN_FILES,
  COORD_ENGAGE_SCAN_PACKAGES,
  COORD_TOO_BIG_BAND,
} from '../advisor/policy.ts';
import type { RankedFile } from '../codescan/rank.ts';
import { areaOf } from '../orchestration/critic-rule.ts';
import { namedFiles } from '../orchestration/context.ts';

export type EngageReason = 'requested' | 'plan' | 'scan' | 'size';

export interface EngageFacts {
  request: string;
  planItems: readonly string[];
  likely: readonly Pick<RankedFile, 'path' | 'package'>[];
  sizeEstimate: number;
  budgetTokens: number;
  followUpRound?: boolean;
}

export interface Engagement {
  engage: boolean;
  reason: EngageReason | null;
  detail: string;
  tooBigUnsure: boolean;
  solo: string | null;
}

const SPLIT = '(?:split|break) (?:this|it|the work|the task|the change|the request)';
const PIECES = '(?:\\d+ |several |separate |smaller )?(?:pieces|parts|chunks|tasks)';

const REQUESTED = new RegExp(
  `\\b(?:${SPLIT} (?:up|down)\\b|${SPLIT} (?:up |down )?into ${PIECES}\\b|in (?:\\d+ |several |separate )?pieces\\b|parallel builders|in worktrees|use (?:several|multiple|parallel) (?:builders|agents))`,
  'i',
);

export function likelyFiles<T extends Pick<RankedFile, 'termsMatched' | 'score'>>(
  candidates: readonly T[],
): T[] {
  return candidates.filter((file) => file.termsMatched > 0 && file.score >= BROAD_SCAN_SCORE);
}

const OUTSIDE_SEGMENT = /^\.+$/;

function inProject(file: string): boolean {
  return !file.split('/').some((segment) => OUTSIDE_SEGMENT.test(segment));
}

export function planAreas(items: readonly string[]): number {
  return new Set(namedFiles(items).filter(inProject).map(areaOf)).size;
}

export function soloReason(facts: EngageFacts): string | null {
  return facts.followUpRound ? 'a PR follow-up round' : null;
}

export function engagement(facts: EngageFacts): Engagement {
  const tooBigUnsure =
    Math.abs(facts.sizeEstimate - facts.budgetTokens) <= facts.budgetTokens * COORD_TOO_BIG_BAND;
  const result = (
    reason: EngageReason | null,
    detail: string,
    solo: string | null = null,
  ): Engagement => ({
    engage: reason !== null,
    reason,
    detail,
    tooBigUnsure,
    solo,
  });
  if (REQUESTED.test(facts.request)) return result('requested', 'the request asks for pieces');
  const solo = soloReason(facts);
  if (solo) return result(null, solo, solo);
  const areas = planAreas(facts.planItems);
  if (facts.planItems.length >= COORD_ENGAGE_PLAN_ITEMS && areas >= COORD_ENGAGE_PLAN_AREAS) {
    return result(
      'plan',
      `the agreed plan has ${facts.planItems.length} open items in ${areas} areas`,
    );
  }
  const packages = new Set(facts.likely.map((file) => file.package).filter((name) => name !== '.'));
  if (
    facts.likely.length >= COORD_ENGAGE_SCAN_FILES ||
    packages.size >= COORD_ENGAGE_SCAN_PACKAGES
  ) {
    return result(
      'scan',
      `the code scan found ${facts.likely.length} likely files in ${packages.size} packages`,
    );
  }
  if (facts.sizeEstimate > facts.budgetTokens) {
    return result(
      'size',
      `about ${Math.round(facts.sizeEstimate / 1000)}K tokens, over the ${Math.round(facts.budgetTokens / 1000)}K Builder budget`,
    );
  }
  return result(null, oneBuilderDetail(facts, areas, packages.size));
}

function oneBuilderDetail(facts: EngageFacts, areas: number, packages: number): string {
  const k = (tokens: number) => `${Math.round(tokens / 1000)}K`;
  return [
    `fits one Builder: ${facts.planItems.length} plan items in ${areas} areas (splits at ${COORD_ENGAGE_PLAN_ITEMS} in ${COORD_ENGAGE_PLAN_AREAS})`,
    `${facts.likely.length} likely files in ${packages} packages (splits at ${COORD_ENGAGE_SCAN_FILES} or ${COORD_ENGAGE_SCAN_PACKAGES})`,
    `about ${k(facts.sizeEstimate)} of ${k(facts.budgetTokens)} tokens`,
  ].join('; ');
}
