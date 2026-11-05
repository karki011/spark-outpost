import type { ReactNode } from 'react';
import { Mark, roveMarks } from './Mark.tsx';
import { useChartWidth } from './use-chart-width.ts';

interface HBar {
  key: string;
  label: string;
  value: number;
  valueText: string;
  tip: string;
  fill: string;
  stroke?: string | undefined;
  marker?: number | null;
}

const ROW = 30;
const BAR = 16;

export function HBars({
  bars,
  ariaLabel,
  defs,
}: {
  bars: readonly HBar[];
  ariaLabel: string;
  defs?: ReactNode;
}) {
  const { ref, width } = useChartWidth<HTMLDivElement>(420, 260);
  const labelWidth = Math.min(150, Math.round(width * 0.34));
  const valueWidth = 76;
  const room = Math.max(40, width - labelWidth - valueWidth - 12);
  const max = Math.max(...bars.map((bar) => Math.max(bar.value, bar.marker ?? 0)), 1e-9);
  return (
    <div ref={ref} className="an-fill">
      <svg
        width={width}
        height={bars.length * ROW}
        role="group"
        aria-label={ariaLabel}
        onKeyDown={roveMarks}
      >
        {defs && <defs>{defs}</defs>}
        {bars.map((bar, index) => {
          const y = index * ROW;
          const w = Math.max(bar.value > 0 ? 3 : 0, (bar.value / max) * room);
          const marker =
            bar.marker === null || bar.marker === undefined
              ? null
              : labelWidth + (bar.marker / max) * room;
          return (
            <Mark key={bar.key} label={bar.tip} first={index === 0}>
              <rect className="an-hit" x={0} y={y + 1} width={width} height={ROW - 2} rx={6} />
              <text className="an-bar-label" x={0} y={y + ROW / 2 + 4}>
                {bar.label}
              </text>
              <rect
                className="an-bar-track"
                x={labelWidth}
                y={y + (ROW - BAR) / 2}
                width={room}
                height={BAR}
                rx={4}
              />
              <rect
                x={labelWidth}
                y={y + (ROW - BAR) / 2}
                width={w}
                height={BAR}
                rx={4}
                style={{ fill: bar.fill, stroke: bar.stroke }}
                strokeWidth={bar.stroke ? 1.5 : 0}
              />
              {marker !== null && (
                <line className="an-marker" x1={marker} x2={marker} y1={y + 4} y2={y + ROW - 4} />
              )}
              <text className="an-bar-value" x={width} y={y + ROW / 2 + 4} textAnchor="end">
                {bar.valueText}
              </text>
            </Mark>
          );
        })}
      </svg>
    </div>
  );
}
