import type { Profile } from '@spark-outpost/contracts';
import { ProfileChoiceSetting } from './ProfileChoiceSetting.tsx';
import { ProfileSwitchSetting } from './ProfileSwitchSetting.tsx';

const OPEN_AS_CHOICES = [
  { id: 'ready', label: 'Ready for review', value: true },
  { id: 'draft', label: 'Draft', value: false },
];

const FOLLOW_UP_INFO = {
  lead: 'After Spark opens a PR from a chat, it watches checks and reviews until the PR is merged or closed.',
  items: [
    {
      label: 'Acts on',
      text: 'Failing checks and comments from people who can write to the repo. Anyone else is shown to you, never acted on.',
    },
    {
      label: 'Pushes and replies',
      text: 'One confirm card in Review each step and Automatic; by itself in Full auto.',
    },
    {
      label: 'Never',
      text: 'Force-pushes, merges, approves, resolves threads or dismisses reviews. Disagreements go to you; 3 rounds per PR at most.',
    },
  ],
};

export function OpenPullRequestsAsSetting({ ready }: { ready: boolean }) {
  return (
    <ProfileChoiceSetting
      saved={ready}
      choices={OPEN_AS_CHOICES}
      label="Open pull requests as"
      doc={{ page: 'ship-and-pull-requests', heading: 'ready-for-review-or-draft' }}
      hint={(value) =>
        value
          ? 'Reviewers are asked right away. A Full auto PR whose checks still fail opens as a draft marked “Checks failing”.'
          : 'PRs open as drafts; mark them ready on GitHub when you are.'
      }
      toUpdate={(value) => ({ prReadyForReview: value })}
    />
  );
}

export function PrFollowUpSettings({ profile }: { profile: Profile }) {
  const off = !profile.prFollowUp;
  return (
    <>
      <ProfileSwitchSetting
        enabled={profile.prFollowUp}
        label="Follow up on pull requests"
        info={FOLLOW_UP_INFO}
        doc={{ page: 'pr-follow-up' }}
        hint={(on) =>
          on
            ? 'Spark fixes failing checks and review feedback, then pushes and replies.'
            : 'Spark leaves PRs alone after it opens them.'
        }
        toUpdate={(value) => ({ prFollowUp: value })}
      />
      <ProfileSwitchSetting
        enabled={profile.prFollowUpChecks}
        disabled={off}
        label="Fix failing checks"
        info="When a check fails on a PR Spark opened, a Builder fixes it in the chat’s worktree."
        hint="Uses the chat’s model and routing."
        toUpdate={(value) => ({ prFollowUpChecks: value })}
      />
      <ProfileSwitchSetting
        enabled={profile.prFollowUpReviews}
        disabled={off}
        label="Handle review comments"
        info="Review comments, reviews and PR comments, from people and bots like Copilot or CodeRabbit, are triaged by Jev, or by rules when Jev isn’t connected."
        hint="Fixes and answers comments from people who can write to the repo."
        toUpdate={(value) => ({ prFollowUpReviews: value })}
      />
      <ProfileSwitchSetting
        enabled={profile.prFollowUpReplies}
        disabled={off}
        label="Reply on GitHub threads"
        info="Spark replies on each thread it handled, like “Fixed in 1a2b3c4: …”, or answers the question."
        hint="Replies are marked as coming from Spark."
        toUpdate={(value) => ({ prFollowUpReplies: value })}
      />
    </>
  );
}
