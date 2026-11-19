import type { TerminalMeasure } from '@spark-outpost/contracts';
import { clock } from '../../calendar/calendar-format.ts';
import { limitRows, resetWhen } from './limits-text.ts';

export function TerminalLimits({ measure }: { measure: TerminalMeasure | null | undefined }) {
  const measuredAt = measure ? Date.parse(measure.at) : Number.NaN;
  const rows = measure ? limitRows(measure, (at) => resetWhen(at, measuredAt, clock)) : [];
  if (rows.length === 0) return null;
  return (
    <section className="tu-reported" aria-label="Usage limits">
      <div className="wsec-h">
        <h3>Usage limits</h3>
        <span>reported by Claude Code</span>
      </div>
      <ul className="tu-models" aria-label="Usage limits">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="tu-name">{row.name}</span>
            <span>{row.detail ?? ''}</span>
            <span className="tu-cost">{row.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
