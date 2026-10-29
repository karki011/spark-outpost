import { ProfileSwitchSetting } from './ProfileSwitchSetting.tsx';

export const COLLAPSE_TURNS_LABEL = 'Collapse finished turns';

export function CollapseTurnsSetting({ enabled }: { enabled: boolean }) {
  return (
    <ProfileSwitchSetting
      enabled={enabled}
      label={COLLAPSE_TURNS_LABEL}
      info="Folds a finished turn's steps and in-between notes behind one Worked for line. The answer, changes, cards and errors stay in view."
      doc={{ page: 'follow-a-turn', heading: 'after-a-turn' }}
      hint={(on) =>
        on
          ? 'Finished turns show the answer under one Worked for line you can open.'
          : 'Finished turns show every step and note.'
      }
      toUpdate={(value) => ({ collapseFinishedTurns: value })}
    />
  );
}
