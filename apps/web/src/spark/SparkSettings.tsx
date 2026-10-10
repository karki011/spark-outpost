import { useId } from 'react';
import { DISPLAY_NAME_MAX_LENGTH, type Personality } from '@spark-outpost/contracts';
import { ProfileChoiceSetting } from '../settings/ProfileChoiceSetting.tsx';
import { SettingRow } from '../settings/SettingRow.tsx';
import { useDisplayNameSave } from './use-display-name.ts';
import { PERSONALITY_HINTS } from './voice.ts';

const NAME_LABEL = 'What should Spark call you?';

const NAME_INFO =
  'Spark greets you with your first name, and agents use it when they explain something or ask you a question.';

interface NameSettingProps {
  name: string;
  onName: (name: string) => void;
  autoFocus?: boolean;
  onEnter?: () => void;
}

function nameHint(name: string, saving: boolean, error: string | null): string {
  if (name.trim() === '') return 'Enter a name to save it.';
  if (error) return error;
  return saving ? 'Saving…' : 'Changes save automatically.';
}

export function NameSetting({ name, onName, autoFocus = false, onEnter }: NameSettingProps) {
  const inputId = useId();
  const hintId = useId();
  const save = useDisplayNameSave();
  return (
    <SettingRow
      label={NAME_LABEL}
      controlId={inputId}
      info={NAME_INFO}
      hint={nameHint(name, save.saving, save.error)}
      hintId={hintId}
    >
      <input
        id={inputId}
        className="inp spark-name"
        value={name}
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        placeholder="Your name"
        autoComplete="given-name"
        autoFocus={autoFocus}
        aria-describedby={hintId}
        onChange={(event) => {
          onName(event.target.value);
          save.schedule(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !onEnter) return;
          event.preventDefault();
          onEnter();
        }}
      />
    </SettingRow>
  );
}

const PERSONALITY_CHOICES: { id: Personality; label: string; value: Personality }[] = [
  { id: 'playful', label: 'Playful', value: 'playful' },
  { id: 'friendly', label: 'Friendly', value: 'friendly' },
  { id: 'facts', label: 'Just the facts', value: 'facts' },
];

const PERSONALITY_INFO = {
  lead: 'How Spark talks in the app. Agents get a short tone line too.',
  items: PERSONALITY_CHOICES.map((choice) => ({
    label: choice.label,
    text: PERSONALITY_HINTS[choice.value],
  })),
  footer: 'Errors always stay plain.',
};

export function PersonalitySetting({ personality }: { personality: Personality }) {
  return (
    <ProfileChoiceSetting
      saved={personality}
      choices={PERSONALITY_CHOICES}
      label="Personality"
      info={PERSONALITY_INFO}
      hint={(value) => PERSONALITY_HINTS[value]}
      toUpdate={(value) => ({ personality: value })}
    />
  );
}
