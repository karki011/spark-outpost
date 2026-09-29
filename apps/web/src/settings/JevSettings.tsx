import { AUTO_CONTINUE_CHOICES, type Profile } from '@spark-outpost/contracts';
import { ProfileChoiceSetting } from './ProfileChoiceSetting.tsx';
import { ProfileSwitchSetting } from './ProfileSwitchSetting.tsx';

const WAIT_CHOICES = AUTO_CONTINUE_CHOICES.map((seconds) => ({
  id: seconds === null ? 'off' : String(seconds),
  label: seconds === null ? 'Off' : `${seconds}s`,
  value: seconds,
}));

const WAIT_INFO =
  'Covers questions such as an unclear request, a stuck step or a change Jev could not verify. Approvals always wait for you.';

const DIFFS_INFO =
  'Proposed edits are checked by observation only and never blocked or allowed. The final diff is verified, and a change Jev finds incomplete is redone once by a stronger model. Jev also uses the diff to tell which review findings need a fix.';

interface JevSettingsProps {
  profile: Profile;
  jevConnected: boolean;
}

export function JevSettings({ profile, jevConnected }: JevSettingsProps) {
  return (
    <div className="jev-settings">
      <ProfileChoiceSetting
        saved={profile.autoContinueSeconds}
        choices={WAIT_CHOICES}
        label="If you don’t answer a question"
        info={WAIT_INFO}
        hint="Spark picks the safe option."
        toUpdate={(value) => ({ autoContinueSeconds: value })}
      />
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
    </div>
  );
}
