import './auto-review.css';
import { useId } from 'react';
import type { GithubReviewSettings } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { SettingRow } from '../settings/SettingRow.tsx';
import { WarnIcon } from '../ui/icons.tsx';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import {
  approveBlocked,
  autoReviewBlocked,
  reviewerKey,
  withCurrentReviewer,
  type AutoReviewSwitch,
  type ReviewerGroups,
} from './auto-review-model.ts';
import { ReviewerList } from './ReviewerList.tsx';
import { useReviewerGroups, useReviewSettings } from './use-review-settings.ts';

export const REVIEW_WITH = 'Review with';
export const REVIEW_AUTOMATICALLY = 'Review automatically';
export const MAY_POST = 'Reviewer may post to GitHub';
export const MAY_APPROVE = 'Reviewer may approve';
export const AUTO_REVIEW_ROWS = [REVIEW_WITH, REVIEW_AUTOMATICALLY, MAY_POST, MAY_APPROVE];

const AUTO_HINT =
  'Reviews pull requests where your review is requested, and again when new commits arrive. Drafts wait until they are ready.';
const POST_HINT =
  'Whether and what to post is up to the reviewer’s own instructions; Spark only allows it, and only on the pull request it reviews.';
const APPROVE_HINT = 'It never merges, pushes or requests changes.';

interface AutoReviewControlsProps {
  onOpenSparks?: (() => void) | undefined;
}

interface SwitchRowProps {
  label: string;
  field: AutoReviewSwitch;
  settings: GithubReviewSettings;
  hint: string;
  blocked: string | null;
  onChange: (field: AutoReviewSwitch, value: boolean) => void;
}

function SwitchRow({ label, field, settings, hint, blocked, onChange }: SwitchRowProps) {
  const switchId = useId();
  const hintId = useId();
  return (
    <SettingRow
      label={label}
      controlId={switchId}
      hint={blocked ?? hint}
      hintId={hintId}
      disabled={blocked !== null}
    >
      <BlobToggle
        id={switchId}
        label={label}
        checked={settings[field]}
        disabled={blocked !== null}
        describedBy={hintId}
        onChange={(value) => onChange(field, value)}
      />
    </SettingRow>
  );
}

function NoReviewers({ onOpenSparks }: AutoReviewControlsProps) {
  return (
    <div className="ar-none">
      <p>
        Make a Spark or a workflow on the Sparks page first; it reviews with its own instructions.
      </p>
      {onOpenSparks && (
        <button type="button" className="btn line" onClick={onOpenSparks}>
          Open Sparks
        </button>
      )}
    </div>
  );
}

interface ReviewWithRowProps extends AutoReviewControlsProps {
  settings: GithubReviewSettings;
  groups: ReviewerGroups;
  loading: boolean;
  onPick: Parameters<typeof ReviewerList>[0]['onPick'];
}

function ReviewWithRow({ settings, groups, loading, onPick, onOpenSparks }: ReviewWithRowProps) {
  const hintId = useId();
  const shown = withCurrentReviewer(groups, settings);
  const empty = !loading && shown.sparks.length === 0 && shown.workflows.length === 0;
  return (
    <SettingRow
      label={REVIEW_WITH}
      hint="One Spark or one workflow. It reviews with its own instructions."
      hintId={hintId}
    >
      {empty ? (
        <NoReviewers onOpenSparks={onOpenSparks} />
      ) : (
        <ReviewerList
          groups={shown}
          value={reviewerKey(settings.reviewer)}
          describedBy={hintId}
          onPick={onPick}
        />
      )}
    </SettingRow>
  );
}

export function AutoReviewControls({ onOpenSparks }: AutoReviewControlsProps) {
  const { query, settings, saveError, change } = useReviewSettings();
  const reviewers = useReviewerGroups();
  if (!settings) {
    return (
      <QueryWait query={query} what="auto-review">
        <Skeleton label="Loading auto-review" shape="lines" rows={4} />
      </QueryWait>
    );
  }
  const onSwitch = (field: AutoReviewSwitch, value: boolean) => change({ field, value });
  return (
    <div className="ar-controls">
      {saveError && (
        <p className="ar-error" role="alert">
          <WarnIcon />
          <span>Couldn’t save: {saveError}</span>
        </p>
      )}
      <ReviewWithRow
        settings={settings}
        groups={reviewers.groups}
        loading={reviewers.loading}
        onPick={(reviewer) => change({ reviewer })}
        onOpenSparks={onOpenSparks}
      />
      <SwitchRow
        label={REVIEW_AUTOMATICALLY}
        field="autoReview"
        settings={settings}
        hint={AUTO_HINT}
        blocked={autoReviewBlocked(settings)}
        onChange={onSwitch}
      />
      <SwitchRow
        label={MAY_POST}
        field="mayPost"
        settings={settings}
        hint={POST_HINT}
        blocked={null}
        onChange={onSwitch}
      />
      <SwitchRow
        label={MAY_APPROVE}
        field="mayApprove"
        settings={settings}
        hint={APPROVE_HINT}
        blocked={approveBlocked(settings)}
        onChange={onSwitch}
      />
    </div>
  );
}
