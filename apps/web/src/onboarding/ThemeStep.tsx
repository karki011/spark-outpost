import { ThemeCards } from '../theme/ThemeCards.tsx';

export function ThemeStep() {
  return (
    <>
      <h2 id="onbTitle">Pick a theme</h2>
      <p className="lede">
        Choose how Spark Outpost looks. You can change it anytime from the chat header.
      </p>
      <ThemeCards />
    </>
  );
}
