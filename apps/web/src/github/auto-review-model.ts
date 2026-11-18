import type {
  GithubReviewSettings,
  GithubReviewSettingsUpdate,
  GithubReviewerKind,
} from '@spark-outpost/contracts';

export interface ReviewerOption {
  kind: GithubReviewerKind;
  id: string;
  name: string;
}

export interface ReviewerGroups {
  sparks: ReviewerOption[];
  workflows: ReviewerOption[];
}

export type AutoReviewSwitch = 'autoReview' | 'mayPost' | 'mayApprove';

export type AutoReviewChange =
  { reviewer: ReviewerOption | null } | { field: AutoReviewSwitch; value: boolean };

export const NO_REVIEWER_KEY = 'none';
export const MISSING_REVIEWER = 'Reviewer not found';
export const AUTO_NEEDS_REVIEWER = 'Pick a reviewer under Review with first.';
export const APPROVE_NEEDS_POST = 'Turn on Reviewer may post to GitHub first.';

export function reviewerKey(reviewer: { kind: GithubReviewerKind; id: string } | null): string {
  return reviewer ? `${reviewer.kind}:${reviewer.id}` : NO_REVIEWER_KEY;
}

export function applyChange(
  current: GithubReviewSettings,
  change: AutoReviewChange,
): GithubReviewSettings {
  if ('reviewer' in change) {
    const reviewer = change.reviewer;
    return {
      ...current,
      reviewer: reviewer ? { kind: reviewer.kind, id: reviewer.id } : null,
      reviewerName: reviewer?.name ?? null,
      autoReview: reviewer ? current.autoReview : false,
    };
  }
  if (change.field === 'autoReview') {
    return { ...current, autoReview: change.value && current.reviewer !== null };
  }
  if (change.field === 'mayPost') {
    return { ...current, mayPost: change.value, mayApprove: change.value && current.mayApprove };
  }
  return { ...current, mayApprove: change.value && current.mayPost };
}

export function toUpdate(settings: GithubReviewSettings): GithubReviewSettingsUpdate {
  return {
    reviewer: settings.reviewer,
    autoReview: settings.autoReview,
    mayPost: settings.mayPost,
    mayApprove: settings.mayApprove,
  };
}

export function autoReviewBlocked(settings: GithubReviewSettings): string | null {
  return settings.reviewer ? null : AUTO_NEEDS_REVIEWER;
}

export function approveBlocked(settings: GithubReviewSettings): string | null {
  return settings.mayPost ? null : APPROVE_NEEDS_POST;
}

export function reviewerLabel(settings: GithubReviewSettings): string | null {
  if (!settings.reviewer) return null;
  return settings.reviewerName ?? MISSING_REVIEWER;
}

export function chipLabel(settings: GithubReviewSettings | undefined): string {
  if (!settings) return 'Auto-review';
  const state = settings.autoReview ? 'Auto-review on' : 'Auto-review off';
  const name = reviewerLabel(settings);
  return name ? `${state} · ${name}` : state;
}

export function withCurrentReviewer(
  groups: ReviewerGroups,
  settings: GithubReviewSettings | undefined,
): ReviewerGroups {
  const reviewer = settings?.reviewer;
  if (!reviewer) return groups;
  const all = [...groups.sparks, ...groups.workflows];
  if (all.some((option) => reviewerKey(option) === reviewerKey(reviewer))) return groups;
  const missing = { ...reviewer, name: reviewerLabel(settings) ?? MISSING_REVIEWER };
  return reviewer.kind === 'spark'
    ? { ...groups, sparks: [...groups.sparks, missing] }
    : { ...groups, workflows: [...groups.workflows, missing] };
}
