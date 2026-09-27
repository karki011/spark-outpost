import { useId } from 'react';
import type { SpendDay } from '@spark-outpost/contracts';
import { shortDate, usd } from '../analytics-model.ts';
import { Mark, roveMarks } from './Mark.tsx';
import { HatchPattern } from './Patterns.tsx';
import { linear, niceMax } from './scale.ts';
import { useChartWidth } from './use-chart-width.ts';

const HEIGHT = 170;
const PAD = { top: 10, right: 8, bottom: 24, left: 48 };

export function DailyStack({ days }: { days: readonly SpendDay[] }) {
  const hatch = useId();
  const { ref, width } = useChartWidth<HTMLDivElement>(520, 280);
  const max = niceMax(Math.max(...days.map((day) => day.reportedUsd + day.estimatedUsd), 0.01));
  const y = linear([0, max], [HEIGHT - PAD.bottom, PAD.top]);
  const slot = (width - PAD.left - PAD.right) / Math.max(1, days.length);
  const bar = Math.max(2, Math.min(18, slot - 2));
  const base = y(0);
  const labelled = new Set([0, Math.floor((days.length - 1) / 2), days.length - 1]);
  return (
    <div ref={ref} className="an-fill">
      <svg
        width={width}
        height={HEIGHT}
        role="group"
        aria-label="Reported and estimated spend per day"
        onKeyDown={roveMarks}
      >
        <defs>
          <HatchPattern id={hatch} color="var(--accent)" />
        </defs>
        <g aria-hidden="true" className="an-axis">
          {[0, max / 2, max].map((tick) => (
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
          {days.map((day, index) =>
            labelled.has(index) ? (
              <text
                key={day.date}
                x={PAD.left + slot * index + slot / 2}
                y={HEIGHT - 6}
                textAnchor="middle"
              >
                {shortDate(day.date)}
              </text>
            ) : null,
          )}
        </g>
        {days.map((day, index) => {
          const x = PAD.left + slot * index + (slot - bar) / 2;
          const reportedTop = y(day.reportedUsd);
          const totalTop = y(day.reportedUsd + day.estimatedUsd);
          const gap = day.reportedUsd > 0 && day.estimatedUsd > 0 ? 1 : 0;
          return (
            <Mark
              key={day.date}
              first={index === days.length - 1}
              label={`${shortDate(day.date)}: ${usd(day.reportedUsd)} reported, ${usd(day.estimatedUsd)} estimated`}
            >
              <rect
                className="an-hit"
                x={PAD.left + slot * index}
                y={PAD.top}
                width={slot}
                height={base - PAD.top}
              />
              {day.reportedUsd > 0 && (
                <rect
                  className="an-bar-reported"
                  x={x}
                  y={reportedTop}
                  width={bar}
                  height={base - reportedTop}
                  rx={Math.min(3, bar / 3)}
                />
              )}
              {day.estimatedUsd > 0 && (
                <rect
                  x={x}
                  y={totalTop}
                  width={bar}
                  height={Math.max(1, reportedTop - totalTop - gap)}
                  rx={Math.min(3, bar / 3)}
                  style={{ fill: `url(#${hatch})`, stroke: 'var(--accent)' }}
                  strokeWidth={1}
                />
              )}
            </Mark>
          );
        })}
      </svg>
      <ul className="an-legend">
        <li>
          <i className="an-swatch" style={{ background: 'var(--accent)' }} />
          Reported by the provider
        </li>
        <li>
          <svg width="14" height="14" aria-hidden="true">
            <defs>
              <HatchPattern id={`${hatch}l`} color="var(--accent)" />
            </defs>
            <rect
              x="1"
              y="1"
              width="12"
              height="12"
              rx="3"
              style={{ fill: `url(#${hatch}l)`, stroke: 'var(--accent)' }}
            />
          </svg>
          Estimated from tokens
        </li>
      </ul>
    </div>
  );
}
