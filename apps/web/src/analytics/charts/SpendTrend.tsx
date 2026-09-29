import { useId } from 'react';
import { shortDate, usd } from '../analytics-model.ts';
import { Mark, roveMarks } from './Mark.tsx';
import { linear, movingAverage, niceMax, smoothPath } from './scale.ts';
import { useChartWidth } from './use-chart-width.ts';

interface TrendPoint {
  date: string;
  value: number;
}

const HEIGHT = 170;
const PAD = { top: 12, right: 12, bottom: 24, left: 48 };

export function SpendTrend({ points }: { points: readonly TrendPoint[] }) {
  const gradient = useId();
  const { ref, width } = useChartWidth<HTMLDivElement>(520, 280);
  const max = niceMax(Math.max(...points.map((point) => point.value), 0.01));
  const x = linear([0, Math.max(1, points.length - 1)], [PAD.left, width - PAD.right]);
  const y = linear([0, max], [HEIGHT - PAD.bottom, PAD.top]);
  const line = points.map((point, index) => [x(index), y(point.value)] as [number, number]);
  const averages = movingAverage(
    points.map((point) => point.value),
    7,
  );
  const average = averages.map((value, index) => [x(index), y(value)] as [number, number]);
  const base = y(0);
  const area =
    line.length > 0
      ? `${smoothPath(line)} L${line.at(-1)![0]},${base} L${line[0]![0]},${base} Z`
      : '';
  const band = points.length > 1 ? x(1) - x(0) : width - PAD.left - PAD.right;
  const ticks = [0, max / 2, max];
  const labelled = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  return (
    <div ref={ref} className="an-fill">
      <svg
        width={width}
        height={HEIGHT}
        role="group"
        aria-label="Spend per day"
        onKeyDown={roveMarks}
      >
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--accent)', stopOpacity: 0.28 }} />
            <stop offset="1" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <g aria-hidden="true" className="an-axis">
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className="an-gridline"
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end">
                {usd(tick)}
              </text>
            </g>
          ))}
          {points.map((point, index) =>
            labelled.has(index) ? (
              <text
                key={point.date}
                x={x(index)}
                y={HEIGHT - 6}
                textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
              >
                {shortDate(point.date)}
              </text>
            ) : null,
          )}
          <path d={area} style={{ fill: `url(#${gradient})` }} />
          <path className="an-line" d={smoothPath(line)} />
          <path className="an-line-avg" d={smoothPath(average)} />
        </g>
        {points.map((point, index) => (
          <Mark
            key={point.date}
            label={`${shortDate(point.date)}: ${usd(point.value)}, 7-day average ${usd(averages[index] ?? 0)}`}
            first={index === points.length - 1}
            className="an-band"
          >
            <rect
              className="an-hit an-band-hit"
              x={x(index) - band / 2}
              y={PAD.top}
              width={band}
              height={base - PAD.top}
            />
            <line className="an-guide" x1={x(index)} x2={x(index)} y1={PAD.top} y2={base} />
            <circle className="an-dot" cx={x(index)} cy={y(point.value)} r={4} />
          </Mark>
        ))}
      </svg>
    </div>
  );
}
