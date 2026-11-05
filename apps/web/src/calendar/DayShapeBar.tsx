import './calendar-parts.css';
import { workWindow, type DayShape } from '@spark-outpost/contracts';

interface DayShapeBarProps {
  shape: DayShape;
  dayStart: number;
  label: string;
}

export function DayShapeBar({ shape, dayStart, label }: DayShapeBarProps) {
  const window = workWindow(dayStart);
  const length = window.end - window.start;
  return (
    <span className="td-bar" role="img" aria-label={label}>
      {shape.bars.map((bar, index) => (
        <i
          key={`${bar.start}-${bar.kind}-${index}`}
          data-kind={bar.kind}
          style={{
            left: `${((bar.start - window.start) / length) * 100}%`,
            width: `${((bar.end - bar.start) / length) * 100}%`,
          }}
        />
      ))}
    </span>
  );
}
