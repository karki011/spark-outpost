import { GATE_LINES, type ConfidencePoint } from '@spark-outpost/contracts';
import { signedScore, verdictName } from '../analytics-model.ts';
import { Mark, roveMarks } from './Mark.tsx';
import { linear, smoothPath } from './scale.ts';
import { useChartWidth } from './use-chart-width.ts';
import { ShapeLegend, VerdictShape } from './VerdictShape.tsx';

const HEIGHT = 280;
const PAD = { top: 46, right: 16, bottom: 30, left: 40 };
const BIN = 0.05;
const MIN_BIN = 3;

const DECISIONS: Record<string, string> = {
  act: 'Jev’s pick applied',
  ask: 'you were asked',
  fallback: 'the rules applied',
};

export function calibration(
  points: readonly ConfidencePoint[],
): { x: number; y: number; n: number }[] {
  const bins = new Map<number, number[]>();
  for (const point of points) {
    if (point.score === null) continue;
    const bin = Math.min(Math.floor(point.confidence / BIN), Math.floor(1 / BIN) - 1);
    bins.set(bin, [...(bins.get(bin) ?? []), point.score]);
  }
  return [...bins.entries()]
    .filter(([, scores]) => scores.length >= MIN_BIN)
    .sort((a, b) => a[0] - b[0])
    .map(([bin, scores]) => ({
      x: (bin + 0.5) * BIN,
      y: scores.reduce((sum, score) => sum + score, 0) / scores.length,
      n: scores.length,
    }));
}

function jitter(index: number): number {
  return ((index * 7919) % 11) / 10 - 0.5;
}

export function ConfidenceChart({ points }: { points: readonly ConfidencePoint[] }) {
  const { ref, width } = useChartWidth<HTMLDivElement>(620, 300);
  const low = Math.min(0.4, ...points.map((point) => point.confidence - 0.02));
  const x = linear([low, 1], [PAD.left, width - PAD.right]);
  const y = linear([-1, 1], [HEIGHT - PAD.bottom, PAD.top]);
  const curve = calibration(points);
  const ticks = [low, 0.5, 0.6, 0.7, 0.8, 0.9, 1].filter(
    (tick, index, all) => index === 0 || tick - all[0]! >= 0.05,
  );
  return (
    <div ref={ref} className="an-fill">
      <svg
        width={width}
        height={HEIGHT}
        role="group"
        aria-label="Jev confidence against outcome score"
        onKeyDown={roveMarks}
      >
        <g aria-hidden="true" className="an-axis">
          {[-1, 0, 1].map((tick) => (
            <g key={tick}>
              <line
                className={tick === 0 ? 'an-zero' : 'an-gridline'}
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end">
                {tick > 0 ? `+${tick}` : tick}
              </text>
            </g>
          ))}
          {ticks.map((tick) => (
            <text key={tick} x={x(tick)} y={HEIGHT - 8} textAnchor="middle">
              {tick.toFixed(2)}
            </text>
          ))}
          {GATE_LINES.map((gate, index) => (
            <g key={gate.at}>
              <line
                className="an-gate"
                x1={x(gate.at)}
                x2={x(gate.at)}
                y1={PAD.top - 6 - (index % 2) * 14}
                y2={HEIGHT - PAD.bottom}
              />
              <text
                className="an-gate-label"
                x={x(gate.at) + 4}
                y={PAD.top - 10 - (index % 2) * 14}
              >
                {gate.at.toFixed(2)} {gate.label.toLowerCase()}
              </text>
            </g>
          ))}
          {curve.length > 1 && (
            <path className="an-calib" d={smoothPath(curve.map((bin) => [x(bin.x), y(bin.y)]))} />
          )}
        </g>
        {points.map((point, index) => {
          const cx = x(point.confidence);
          const cy = y(point.score ?? 0) + jitter(index) * 6;
          const decision = point.decision ? `, ${DECISIONS[point.decision]}` : '';
          const line = point.actAt === null ? '' : ` at the ${point.actAt.toFixed(2)} line`;
          return (
            <Mark
              key={index}
              first={index === points.length - 1}
              label={`Confidence ${point.confidence.toFixed(2)}${decision}${line}. Outcome ${verdictName(point.verdict).toLowerCase()}, score ${signedScore(point.score)}`}
            >
              <circle className="an-hit" cx={cx} cy={cy} r={8} />
              <VerdictShape verdict={point.verdict} x={cx} y={cy} />
            </Mark>
          );
        })}
      </svg>
      <div className="an-legend-row">
        <ShapeLegend />
        <p className="an-note">
          <svg width="22" height="10" aria-hidden="true">
            <path className="an-calib" d="M1 5h20" />
          </svg>
          Mean score per 0.05 of confidence (3 or more turns). Dashed lines are the gate lines.
        </p>
      </div>
    </div>
  );
}
