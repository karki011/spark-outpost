import type { OverviewDay } from '@spark-outpost/contracts';
import { plural, shortDate, usd } from '../analytics-model.ts';
import { calendarLayout } from './calendar-layout.ts';
import { Mark, roveMarks } from './Mark.tsx';
import { useChartWidth } from './use-chart-width.ts';

const GAP = 4;
const LEGEND_CELL = 15;
const LEFT = 30;
const TOP = 18;
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

function dayLabel(day: OverviewDay): string {
  if (day.turns === 0) return `${shortDate(day.date)}: no turns`;
  const outcomes = [
    day.good && `${day.good} good`,
    day.mixed && `${day.mixed} mixed`,
    day.bad && `${day.bad} bad`,
  ].filter(Boolean);
  const detail = outcomes.length > 0 ? `, ${outcomes.join(', ')}` : '';
  return `${shortDate(day.date)}: ${plural(day.turns, 'turn')}${detail}, ${usd(day.costUsd)}`;
}

export function ActivityHeatmap({ days }: { days: readonly OverviewDay[] }) {
  const { ref, width: room } = useChartWidth<HTMLDivElement>(480, 200);
  const layout = calendarLayout(days.map((day) => ({ date: day.date, value: day.turns })));
  const CELL = Math.max(
    12,
    Math.min(26, Math.floor((room - LEFT) / Math.max(1, layout.weeks)) - GAP),
  );
  const max = Math.max(1, ...days.map((day) => day.turns));
  const width = LEFT + layout.weeks * (CELL + GAP);
  const height = TOP + 7 * (CELL + GAP);
  return (
    <div ref={ref} className="an-scroll">
      <svg
        className="an-heat"
        width={width}
        height={height}
        role="group"
        aria-label="Turns per day"
        onKeyDown={roveMarks}
      >
        <g aria-hidden="true" className="an-axis">
          {WEEKDAYS.map((label, row) =>
            label ? (
              <text key={row} x={0} y={TOP + row * (CELL + GAP) + CELL - 3}>
                {label}
              </text>
            ) : null,
          )}
          {layout.months.map((month) => (
            <text key={`${month.col}-${month.label}`} x={LEFT + month.col * (CELL + GAP)} y={11}>
              {month.label}
            </text>
          ))}
        </g>
        {layout.cells.map((cell, index) => {
          const day = days[index]!;
          const x = LEFT + cell.col * (CELL + GAP);
          const y = TOP + cell.row * (CELL + GAP);
          const size = day.turns === 0 ? 0 : Math.max(4, CELL * Math.sqrt(day.turns / max));
          const inset = (CELL - size) / 2;
          return (
            <Mark key={day.date} label={dayLabel(day)} first={index === days.length - 1}>
              <rect
                className="an-hit"
                x={x - 1.5}
                y={y - 1.5}
                width={CELL + 3}
                height={CELL + 3}
                rx={5}
              />
              <rect className="an-heat-track" x={x} y={y} width={CELL} height={CELL} rx={4} />
              {size > 0 && (
                <rect
                  className="an-heat-dot"
                  x={x + inset}
                  y={y + inset}
                  width={size}
                  height={size}
                  rx={Math.min(4, size / 3)}
                />
              )}
            </Mark>
          );
        })}
      </svg>
      <p className="an-legend-line" aria-hidden="true">
        <span>Fewer</span>
        {[0.2, 0.45, 0.7, 1].map((share) => (
          <svg key={share} width={LEGEND_CELL} height={LEGEND_CELL} className="an-heat">
            <rect className="an-heat-track" width={LEGEND_CELL} height={LEGEND_CELL} rx={4} />
            <rect
              className="an-heat-dot"
              x={(LEGEND_CELL - LEGEND_CELL * Math.sqrt(share)) / 2}
              y={(LEGEND_CELL - LEGEND_CELL * Math.sqrt(share)) / 2}
              width={LEGEND_CELL * Math.sqrt(share)}
              height={LEGEND_CELL * Math.sqrt(share)}
              rx={3}
            />
          </svg>
        ))}
        <span>More turns</span>
      </p>
    </div>
  );
}
