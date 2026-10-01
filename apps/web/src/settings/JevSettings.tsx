import type { Profile } from '@spark-outpost/contracts';
import { ProfileSwitchSetting } from './ProfileSwitchSetting.tsx';

const DIFFS_INFO = {
  items: [
    { label: 'Proposed edits', text: 'Checked by observation only, never blocked or allowed.' },
    {
      label: 'Final diff',
      text: 'Verified. If Jev finds it incomplete, a stronger model redoes it once.',
    },
    { label: 'Review findings', text: 'Jev uses the diff to tell which ones need a fix.' },
  ],
};

interface JevSettingsProps {
  profile: Profile;
  jevConnected: boolean;
}

export function JevSettings({ profile, jevConnected }: JevSettingsProps) {
  return (
    <ProfileSwitchSetting
      enabled={profile.jevDiffs}
      label="Check changes with Jev"
      info={DIFFS_INFO}
      hint={
        jevConnected
          ? 'Diffs go to TypeSafe and are never used for training.'
          : 'Connect Jev to use this.'
      }
      disabled={!jevConnected}
      toUpdate={(value) => ({ jevDiffs: value })}
    />
  );
}
