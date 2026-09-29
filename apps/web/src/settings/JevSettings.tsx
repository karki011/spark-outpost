import type { Profile } from '@spark-outpost/contracts';
import { ProfileSwitchSetting } from './ProfileSwitchSetting.tsx';

const DIFFS_INFO =
  'Proposed edits are checked by observation only and never blocked or allowed. The final diff is verified, and a change Jev finds incomplete is redone once by a stronger model. Jev also uses the diff to tell which review findings need a fix.';

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
