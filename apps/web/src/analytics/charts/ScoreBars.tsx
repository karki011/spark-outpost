import { signedScore } from '../analytics-model.ts';
import { Mark, roveMarks } from './Mark.tsx';
import { useChartWidth } from './use-chart-width.ts';

interface ScoreRow {
  key: string;
  label: string;
  score: number | null;
  note: string;
  tip: string;
}

const ROW = 34;
const BAR = 14;

export function ScoreBars({ rows, ariaLabel }: { rows: readonly ScoreRow[]; ariaLabel: string }) {
  const { ref, width } = useChartWidth<HTMLDivElement>(420, 260);
  const labelWidth = Math.min(140, Math.round(width * 0.3));
  const noteWidth = Math.min(150, Math.round(width * 0.3));
  const room = Math.max(60, width - labelWidth - noteWidth - 16);
  const center = labelWidth + room / 2;
  return (
    <div ref={ref} className="an-fill">
      <svg
        width={width}
        height={rows.length * ROW + 16}
        role="group"
        aria-label={ariaLabel}
        onKeyDown={roveMarks}
      >
        <g aria-hidden="true" className="an-axis">
          <line className="an-zero" x1={center} x2={center} y1={0} y2={rows.length * ROW} />
          <text x={labelWidth} y={rows.length * ROW + 13}>
            −1
          </text>
          <text x={center} y={rows.length * ROW + 13} textAnchor="middle">
            0
          </text>
          <text x={labelWidth + room} y={rows.length * ROW + 13} textAnchor="end">
            +1
          </text>
        </g>
        {rows.map((row, index) => {
          const y = index * ROW;
          const score = row.score ?? 0;
          const span = (Math.abs(score) * room) / 2;
          const x = score >= 0 ? center : center - span;
          return (
            <Mark key={row.key} label={row.tip} first={index === 0}>
              <rect className="an-hit" x={0} y={y + 1} width={width} height={ROW - 2} rx={6} />
              <text className="an-bar-label" x={0} y={y + ROW / 2 + 4}>
                {row.label}
              </text>
              <rect
                className="an-bar-track"
                x={labelWidth}
                y={y + (ROW - BAR) / 2}
                width={room}
                height={BAR}
                rx={4}
              />
              {row.score !== null && (
                <rect
                  className={score >= 0 ? 'an-score-pos' : 'an-score-neg'}
                  x={x}
                  y={y + (ROW - BAR) / 2}
                  width={Math.max(2, span)}
                  height={BAR}
                  rx={3}
                />
              )}
              <text className="an-bar-value" x={labelWidth + room + 10} y={y + ROW / 2 + 4}>
                {signedScore(row.score)} · {row.note}
              </text>
            </Mark>
          );
        })}
      </svg>
    </div>
  );
}
