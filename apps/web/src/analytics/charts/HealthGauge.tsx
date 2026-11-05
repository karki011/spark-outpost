import type { HealthGrade, HealthScore } from '@spark-outpost/contracts';

const R = 58;
const SWEEP = 240;
const CIRC = 2 * Math.PI * R;
const ARC = (CIRC * SWEEP) / 360;

const GRADES: Record<HealthGrade, { label: string; tone: string }> = {
  healthy: { label: 'Healthy', tone: 'good' },
  fair: { label: 'Fair', tone: 'warn' },
  needs_attention: { label: 'Needs attention', tone: 'bad' },
  not_enough_data: { label: 'Not enough data yet', tone: 'none' },
};

const GRADE_PATHS: Record<HealthGrade, string> = {
  healthy: 'M4 8.5 7 11.5 12.5 5',
  fair: 'M4 8h8',
  needs_attention: 'M8 4v5M8 11.5v.1',
  not_enough_data: 'M6 6.2a2 2 0 1 1 2.6 1.9c-.5.2-.6.6-.6 1.1M8 11.5v.1',
};

function GradeIcon({ grade }: { grade: HealthGrade }) {
  const path = GRADE_PATHS[grade];
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HealthGauge({ health }: { health: HealthScore }) {
  const grade = GRADES[health.grade];
  const share = (health.score ?? 0) / 100;
  return (
    <div className="an-health">
      <div className={`an-gauge tone-${grade.tone}`}>
        <svg width="150" height="132" viewBox="0 0 150 132" aria-hidden="true">
          <circle
            className="an-gauge-track"
            cx="75"
            cy="75"
            r={R}
            strokeDasharray={`${ARC} ${CIRC}`}
            transform="rotate(150 75 75)"
          />
          {health.score !== null && (
            <circle
              className="an-gauge-value"
              cx="75"
              cy="75"
              r={R}
              strokeDasharray={`${ARC * share} ${CIRC}`}
              transform="rotate(150 75 75)"
            />
          )}
        </svg>
        <div className="an-gauge-num">
          <b>{health.score ?? '—'}</b>
          <span>of 100</span>
        </div>
        <p className="an-grade">
          <GradeIcon grade={health.grade} />
          {grade.label}
        </p>
      </div>
      <ul className="an-parts">
        {health.components.map((part) => (
          <li key={part.id}>
            <div className="an-part-h">
              <span>{part.label}</span>
              <b>{part.score === null ? '—' : part.score}</b>
            </div>
            <div className="an-part-bar" aria-hidden="true">
              <i style={{ transform: `scaleX(${(part.score ?? 0) / 100})` }} />
            </div>
            <small>
              {part.detail} Weight {part.weight}%.
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}
