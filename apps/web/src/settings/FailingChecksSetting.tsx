import { ProfileChoiceSetting } from './ProfileChoiceSetting.tsx';

const FAILING_CHECKS_CHOICES = [
  { id: 'open', label: 'Open a draft PR', value: true },
  { id: 'stop', label: 'Stop and ask', value: false },
];

export function FailingChecksSetting({ opensDraft }: { opensDraft: boolean }) {
  return (
    <ProfileChoiceSetting
      saved={opensDraft}
      choices={FAILING_CHECKS_CHOICES}
      label="When checks still fail in Full auto"
      hint="The draft PR is marked “Checks failing”. Full auto never merges."
      toUpdate={(value) => ({ shipFailingChecks: value })}
    />
  );
}
