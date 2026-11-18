import { describe, expect, it } from 'vitest';
import type { GithubReviewSettings } from '@spark-outpost/contracts';
import { searchSettings } from '../settings/settings-search.ts';
import {
  APPROVE_NEEDS_POST,
  AUTO_NEEDS_REVIEWER,
  MISSING_REVIEWER,
  applyChange,
  approveBlocked,
  autoReviewBlocked,
  chipLabel,
  reviewerKey,
  toUpdate,
  withCurrentReviewer,
  type ReviewerOption,
} from './auto-review-model.ts';
import { AUTO_REVIEW_ROWS } from './AutoReviewControls.tsx';

const OFF: GithubReviewSettings = {
  reviewer: null,
  reviewerName: null,
  autoReview: false,
  mayPost: false,
  mayApprove: false,
};

const SPARK: ReviewerOption = {
  kind: 'spark',
  id: '0b9e1f2a-1111-4c3d-9e8f-123456789abc',
  name: 'PR Reviewer',
};
const FLOW: ReviewerOption = { kind: 'workflow', id: 'deep-review', name: 'Deep review' };

function picked(overrides: Partial<GithubReviewSettings> = {}): GithubReviewSettings {
  return applyChange({ ...OFF, ...overrides }, { reviewer: SPARK });
}

describe('chipLabel', () => {
  it('says off with no reviewer', () => {
    expect(chipLabel(OFF)).toBe('Auto-review off');
  });

  it('names the reviewer when on and when off', () => {
    expect(chipLabel(picked({ autoReview: true }))).toBe('Auto-review on · PR Reviewer');
    expect(chipLabel(picked())).toBe('Auto-review off · PR Reviewer');
  });

  it('says the reviewer is missing when the server has no name for it', () => {
    expect(chipLabel({ ...picked(), reviewerName: null })).toBe(
      `Auto-review off · ${MISSING_REVIEWER}`,
    );
  });

  it('reads a plain word while loading', () => {
    expect(chipLabel(undefined)).toBe('Auto-review');
  });
});

describe('applyChange', () => {
  it('picks a reviewer with its name and keeps the switches', () => {
    const next = applyChange({ ...OFF, mayPost: true }, { reviewer: FLOW });
    expect(next).toEqual({
      ...OFF,
      reviewer: { kind: 'workflow', id: 'deep-review' },
      reviewerName: 'Deep review',
      mayPost: true,
    });
  });

  it('turns auto-review off when the reviewer becomes None', () => {
    const on = applyChange(picked(), { field: 'autoReview', value: true });
    expect(on.autoReview).toBe(true);
    expect(applyChange(on, { reviewer: null })).toMatchObject({
      reviewer: null,
      autoReview: false,
    });
  });

  it('keeps auto-review off without a reviewer', () => {
    expect(applyChange(OFF, { field: 'autoReview', value: true }).autoReview).toBe(false);
  });

  it('turns approve off with post, and refuses approve without post', () => {
    const posting = applyChange(picked(), { field: 'mayPost', value: true });
    const approving = applyChange(posting, { field: 'mayApprove', value: true });
    expect(approving).toMatchObject({ mayPost: true, mayApprove: true });
    expect(applyChange(approving, { field: 'mayPost', value: false })).toMatchObject({
      mayPost: false,
      mayApprove: false,
    });
    expect(applyChange(picked(), { field: 'mayApprove', value: true }).mayApprove).toBe(false);
  });

  it('builds the request body without the name', () => {
    expect(toUpdate(picked({ autoReview: true }))).toEqual({
      reviewer: { kind: 'spark', id: SPARK.id },
      autoReview: true,
      mayPost: false,
      mayApprove: false,
    });
  });
});

describe('disabled reasons', () => {
  it('asks for a reviewer before auto-review and for post before approve', () => {
    expect(autoReviewBlocked(OFF)).toBe(AUTO_NEEDS_REVIEWER);
    expect(autoReviewBlocked(picked())).toBeNull();
    expect(approveBlocked(OFF)).toBe(APPROVE_NEEDS_POST);
    expect(approveBlocked({ ...OFF, mayPost: true })).toBeNull();
  });
});

describe('withCurrentReviewer', () => {
  const groups = { sparks: [SPARK], workflows: [FLOW] };

  it('leaves the lists alone when the reviewer is listed', () => {
    expect(withCurrentReviewer(groups, picked())).toBe(groups);
  });

  it('keeps a deleted reviewer visible in its group', () => {
    const gone = {
      ...OFF,
      reviewer: { kind: 'workflow' as const, id: 'old-flow' },
      reviewerName: null,
    };
    const shown = withCurrentReviewer(groups, gone);
    expect(shown.workflows.map(reviewerKey)).toEqual(['workflow:deep-review', 'workflow:old-flow']);
    expect(shown.workflows[1]!.name).toBe(MISSING_REVIEWER);
  });
});

describe('Settings search', () => {
  it('finds the auto-review rows', () => {
    const matches = searchSettings('auto-review', [
      { id: 'pulls', label: 'GitHub', groupLabel: 'Work', rows: AUTO_REVIEW_ROWS },
    ]);
    expect(matches.map((match) => match.row)).toContain('Review automatically');
  });
});
