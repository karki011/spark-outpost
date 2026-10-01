import { AUTONOMY_LEVELS, type InvolvementLevel } from '@spark-outpost/contracts';
import { ProfileChoiceSetting } from '../settings/ProfileChoiceSetting.tsx';

const INFO = {
  items: AUTONOMY_LEVELS.map((level) => ({ label: level.label, text: level.hint })),
  footer: 'Each chat can pick its own in its Work panel.',
};
const CHOICES = AUTONOMY_LEVELS.map((level) => ({
  id: level.id,
  label: level.label,
  value: level.id,
}));

export function LevelSetting({ level }: { level: InvolvementLevel }) {
  return (
    <ProfileChoiceSetting
      saved={level}
      choices={CHOICES}
      label="How much Spark does alone"
      info={INFO}
      doc={{ page: 'chats-and-modes', heading: 'spark-autonomy' }}
      hint="The default for new chats, whichever agent they use."
      toUpdate={(value) => ({ defaultLevel: value })}
    />
  );
}
