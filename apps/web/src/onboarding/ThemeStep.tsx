import { AppearanceSettings } from '../theme/AppearanceSettings.tsx';

export function ThemeStep() {
  return (
    <>
      <h2 id="onbTitle">Pick a look</h2>
      <p className="lede">
        Spark Outpost follows your system&apos;s light and dark setting. Pick a tint, or change it
        anytime from the chat header.
      </p>
      <AppearanceSettings />
    </>
  );
}
