import { useArchiveSetting, useSetArchiveSetting } from '../browser-view/archive-setting.ts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';

export const ARCHIVE_LABEL = 'Archive tabs not shown for';

const OFF = 'off';
const HOUR = 60;
const CHOICES = [
  { id: OFF, label: 'Never' },
  { id: String(HOUR), label: '1 hour' },
  { id: String(6 * HOUR), label: '6 hours' },
  { id: String(12 * HOUR), label: '12 hours' },
  { id: String(24 * HOUR), label: '1 day' },
  { id: String(7 * 24 * HOUR), label: '7 days' },
];

export function BrowserArchiveSetting() {
  const setting = useArchiveSetting();
  const save = useSetArchiveSetting();
  if (!setting) return null;
  const value = setting.on ? String(setting.afterMinutes) : OFF;
  const listed = CHOICES.some((choice) => choice.id === value);
  const choices = listed
    ? CHOICES
    : [...CHOICES, { id: value, label: `${setting.afterMinutes} minutes` }];
  return (
    <div className="set-sites" role="group" aria-label={ARCHIVE_LABEL}>
      <p className="set-hint">
        In the Browser view, a Today tab you haven’t shown for this long closes and moves to
        Archived. Pinned tabs, favorites, a tab playing sound and the tab showing in each Space stay
        open.
      </p>
      <ChoicePicker
        label={ARCHIVE_LABEL}
        choices={choices}
        value={value}
        onChange={(id) =>
          save.mutate(
            id === OFF
              ? { on: false, afterMinutes: setting.afterMinutes }
              : { on: true, afterMinutes: Number(id) },
          )
        }
      />
    </div>
  );
}
