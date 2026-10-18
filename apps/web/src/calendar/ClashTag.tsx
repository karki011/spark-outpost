import './calendar-parts.css';
import { clashText } from '@spark-outpost/contracts';

export function ClashTag({ titles = [] }: { titles?: readonly string[] | undefined }) {
  const text = clashText(titles);
  if (!text) return null;
  return (
    <span className="cal-clash" title={`Clashes with ${titles.join(', ')}`}>
      {text}
    </span>
  );
}
