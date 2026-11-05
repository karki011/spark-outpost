import { useId } from 'react';
import { companionPrefs, useCompanionPrefs } from '../companion/companion-prefs.ts';
import { Segmented } from '../ui/Segmented.tsx';
import { SettingRow } from './SettingRow.tsx';

export const COMPANION_LABEL = 'Status companion';

const OPTIONS = [
  { id: 'show', label: 'Show' },
  { id: 'hide', label: 'Hide' },
];

export function CompanionSetting() {
  const hintId = useId();
  const { hidden } = useCompanionPrefs();
  return (
    <SettingRow
      label={COMPANION_LABEL}
      hint="Scout floats in a corner outside open chats and shows what needs you and what’s running."
      hintId={hintId}
    >
      <Segmented
        ariaLabel={COMPANION_LABEL}
        describedBy={hintId}
        options={OPTIONS}
        value={hidden ? 'hide' : 'show'}
        onChange={(id) => companionPrefs.setHidden(id === 'hide')}
      />
    </SettingRow>
  );
}
