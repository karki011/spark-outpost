import { useId } from 'react';
import { DISPLAY_NAME_MAX_LENGTH, firstName, type Personality } from '@spark-outpost/contracts';
import { ProfileChoiceSetting } from '../settings/ProfileChoiceSetting.tsx';
import { ProfileSwitchSetting } from '../settings/ProfileSwitchSetting.tsx';
import { SettingRow } from '../settings/SettingRow.tsx';
import { useDisplayNameSave } from './use-display-name.ts';
import { PERSONALITY_HINTS } from './voice.ts';

const NAME_LABEL = 'What should Spark call you?';

const NAME_INFO =
  'Spark greets you with your first name. With “Call me by name” on, agents use it too.';

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

export function PersonalitySetting({ personality }: { personality: Personality }) {
  return (
    <ProfileChoiceSetting
      saved={personality}
      choices={PERSONALITY_CHOICES}
      label="Personality"
      info="Sets how Spark talks in the app and adds a short tone line to every agent session. Errors always stay plain."
      hint={(value) => PERSONALITY_HINTS[value]}
      toUpdate={(value) => ({ personality: value })}
    />
  );
}

const SPARK_INFO =
  'On: Jev reads each request and asks when something is unclear, the routing rules pick the model for each step, a Critic reviews bigger changes and Jev checks finished work. Off: chats go straight to the agent and model you picked, with no Jev questions, Critic or extra agents. Approvals and safety rules apply either way.';

export function SparkSwitch({ enabled }: { enabled: boolean }) {
  return (
    <ProfileSwitchSetting
      blob
      enabled={enabled}
      label="Spark"
      info={SPARK_INFO}
      hint={(on) =>
        on
          ? 'Spark reads, routes and reviews your work.'
          : 'Chats go straight to the agent you pick.'
      }
      toUpdate={(value) => ({ sparkEnabled: value })}
    />
  );
}

const TEAM_INFO =
  'Adds an instruction to every agent session: for multi-step work, act as a coordinator, split it into scoped pieces and hand them to subagents; answer simple questions directly. Claude and Z.ai use their built-in subagents in project chats; Codex works through a checklist instead. Applies even when Spark is off.';

export function TeamModeSetting({ enabled }: { enabled: boolean }) {
  return (
    <ProfileSwitchSetting
      blob
      enabled={enabled}
      label="Work like a team"
      info={TEAM_INFO}
      hint="Big jobs get split up. Quick questions get quick answers."
      toUpdate={(value) => ({ teamMode: value })}
    />
  );
}

export function UseNameSetting({
  enabled,
  displayName,
}: {
  enabled: boolean;
  displayName: string;
}) {
  const first = firstName(displayName);
  return (
    <ProfileSwitchSetting
      blob
      enabled={enabled}
      label="Call me by name"
      info="Tells every agent your first name and asks it to use it when it explains something or asks you a question."
      hint={(on) => {
        if (!first) return 'Add your name to use this.';
        return on ? `Agents call you ${first}.` : 'Agents won’t use your name.';
      }}
      toUpdate={(value) => ({ useName: value })}
    />
  );
}

const CRITIC_INFO =
  'After the Builder finishes a bigger or risky change, a Critic agent reviews it and can send fixes back to the Builder. Off: Spark wraps up after the Builder. Asking Spark to review code still runs a review.';

const SPARK_OFF_HINT = 'Spark is off, so no Critic runs.';

export function CriticSetting({ enabled, sparkOn }: { enabled: boolean; sparkOn: boolean }) {
  return (
    <ProfileSwitchSetting
      blob
      enabled={enabled}
      disabled={!sparkOn}
      label="Critic"
      info={CRITIC_INFO}
      hint={(on) => {
        if (!sparkOn) return SPARK_OFF_HINT;
        return on ? 'A second agent reviews bigger changes.' : 'Changes aren’t reviewed.';
      }}
      toUpdate={(value) => ({ criticEnabled: value })}
    />
  );
}

const OTHER_PROVIDER_INFO =
  'With another agent connected, the Critic runs on it, for example Codex reviewing Claude’s work, so a different model family checks the change. Off: the Critic uses the chat’s agent, one model tier up when there is one.';

export function CriticProviderSetting({
  enabled,
  criticOn,
  sparkOn,
}: {
  enabled: boolean;
  criticOn: boolean;
  sparkOn: boolean;
}) {
  return (
    <ProfileSwitchSetting
      blob
      enabled={enabled}
      disabled={!sparkOn || !criticOn}
      label="Use a different provider for the Critic when one’s connected"
      info={OTHER_PROVIDER_INFO}
      hint={(on) => {
        if (!sparkOn) return SPARK_OFF_HINT;
        if (!criticOn) return 'Turn on the Critic to use this.';
        return on
          ? 'A second opinion from another model family.'
          : 'The Critic uses the chat’s agent.';
      }}
      toUpdate={(value) => ({ criticOtherProvider: value })}
    />
  );
}
