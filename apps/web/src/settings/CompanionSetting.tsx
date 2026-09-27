import { companionPrefs, useCompanionPrefs } from '../companion/companion-prefs.ts';
import { Segmented } from '../ui/Segmented.tsx';

const OPTIONS = [
  { id: 'show', label: 'Show' },
  { id: 'hide', label: 'Hide' },
];

export function CompanionSetting() {
  const { hidden } = useCompanionPrefs();
  return (
    <div className="field companion-setting">
      <span>Status companion</span>
      <Segmented
        ariaLabel="Status companion"
        options={OPTIONS}
        value={hidden ? 'hide' : 'show'}
        onChange={(id) => companionPrefs.setHidden(id === 'hide')}
      />
      <p className="set-hint">
        Scout floats in a corner outside open chats and shows what needs you and what’s running.
      </p>
    </div>
  );
}
