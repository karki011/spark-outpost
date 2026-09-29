import { AUTONOMY_LEVELS, type InvolvementLevel } from '@spark-outpost/contracts';
import { ProfileChoiceSetting } from '../settings/ProfileChoiceSetting.tsx';

const INFO = `${AUTONOMY_LEVELS.map((level) => `${level.label}: ${level.hint}`).join(' ')} Each chat can pick its own in the chat’s permissions.`;
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
      hint="The default for new chats, whichever agent they use."
      toUpdate={(value) => ({ defaultLevel: value })}
    />
  );
}
