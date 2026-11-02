import { ProfileSwitchSetting } from './ProfileSwitchSetting.tsx';

export const CODE_MODE_LABEL = 'Code Mode';

export function CodeModeSetting({
  enabled,
  unavailable,
}: {
  enabled: boolean;
  unavailable?: boolean | undefined;
}) {
  return (
    <ProfileSwitchSetting
      enabled={enabled && !unavailable}
      disabled={unavailable === true}
      label={CODE_MODE_LABEL}
      info="Lets agents combine supported ticket, pull request and guide reads locally. Direct tools stay available. No additional permissions or Terminal changes."
      doc={{ page: 'settings', heading: 'code-mode' }}
      hint={(on) =>
        unavailable
          ? 'Disabled for this installation. Your saved preference is kept.'
          : on
            ? 'Agents can combine reads. Changes apply on the next turn.'
            : 'Agents use direct tools. Changes apply on the next turn.'
      }
      toUpdate={(value) => ({ codeMode: value })}
    />
  );
}
