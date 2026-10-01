import { AUTO_CONTINUE_CHOICES } from '@spark-outpost/contracts';
import { ProfileChoiceSetting } from './ProfileChoiceSetting.tsx';

const WAIT_CHOICES = AUTO_CONTINUE_CHOICES.map((seconds) => ({
  id: seconds === null ? 'off' : String(seconds),
  label: seconds === null ? 'Off' : `${seconds}s`,
  value: seconds,
}));

const WAIT_INFO =
  'Covers questions such as an unclear request, a stuck step or a change Jev could not verify. Approvals always wait for you.';

export function AutoContinueSetting({ seconds }: { seconds: number | null }) {
  return (
    <ProfileChoiceSetting
      saved={seconds}
      choices={WAIT_CHOICES}
      label="If you don’t answer a question"
      info={WAIT_INFO}
      doc={{ page: 'approvals', heading: 'if-you-dont-answer' }}
      hint="Spark picks the safe option."
      toUpdate={(value) => ({ autoContinueSeconds: value })}
    />
  );
}
