import type { VerdictCounts } from '@spark-outpost/contracts';
import {
  percent,
  plural,
  RATED_VERDICTS,
  ratedTurns,
  verdictName,
  type RatedVerdict,
} from '../analytics-model.ts';
import { Mark, roveMarks } from './Mark.tsx';
import { useChartWidth } from './use-chart-width.ts';
import {
  useVerdictPatternIds,
  verdictColor,
  verdictFill,
  VerdictPatterns,
} from './VerdictShape.tsx';

const HEIGHT = 22;

function VerdictSwatch({ verdict }: { verdict: RatedVerdict }) {
  const ids = useVerdictPatternIds();
  return (
    <svg width="14" height="14" aria-hidden="true">
      <defs>
        <VerdictPatterns ids={ids} />
      </defs>
      <rect
        x="1"
        y="1"
        width="12"
        height="12"
        rx="3"
        style={{ fill: verdictFill(verdict, ids), stroke: verdictColor(verdict) }}
        strokeWidth={verdict === 'good' ? 0 : 1.5}
      />
    </svg>
  );
}

export function VerdictBar({ counts }: { counts: VerdictCounts }) {
  const ids = useVerdictPatternIds();
  const { ref, width } = useChartWidth<HTMLDivElement>(400, 200);
  const total = ratedTurns(counts);
  const present = RATED_VERDICTS.filter((key) => counts[key] > 0);
  const room = width - (present.length - 1) * 2;
  const widths = present.map((key) => Math.max(3, (counts[key] / total) * room));
  const starts = widths.map((_, index) =>
    widths.slice(0, index).reduce((sum, w) => sum + w + 2, 0),
  );
  return (
    <div ref={ref} className="an-fill">
      <svg width={width} height={HEIGHT} role="group" aria-label="Outcomes" onKeyDown={roveMarks}>
        <defs>
          <VerdictPatterns ids={ids} />
        </defs>
        {present.map((key, index) => {
          const w = widths[index]!;
          const at = starts[index]!;
          return (
            <Mark
              key={key}
              first={index === 0}
              label={`${verdictName(key)}: ${plural(counts[key], 'turn')} (${percent(counts[key], total)})`}
            >
              <rect className="an-hit" x={at - 2} y={0} width={w + 4} height={HEIGHT} rx={6} />
              <rect
                x={at + 1}
                y={2}
                width={Math.max(1, w - 2)}
                height={HEIGHT - 4}
                rx={4}
                style={{ fill: verdictFill(key, ids), stroke: verdictColor(key) }}
                strokeWidth={key === 'good' ? 0 : 1.5}
              />
            </Mark>
          );
        })}
      </svg>
      <ul className="an-legend">
        {RATED_VERDICTS.map((key) => (
          <li key={key}>
            <VerdictSwatch verdict={key} />
            {verdictName(key)} <b>{counts[key]}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
