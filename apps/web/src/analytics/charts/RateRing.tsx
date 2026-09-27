import { ratePercent } from '../analytics-model.ts';

interface RateRingProps {
  label: string;
  rate: number | null;
  detail: string;
}

const R = 30;
const C = 2 * Math.PI * R;

export function RateRing({ label, rate, detail }: RateRingProps) {
  const value = rate ?? 0;
  return (
    <figure className="an-ring">
      <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
        <circle className="an-ring-track" cx="38" cy="38" r={R} />
        {rate !== null && (
          <circle
            className="an-ring-value"
            cx="38"
            cy="38"
            r={R}
            strokeDasharray={`${C * value} ${C}`}
            transform="rotate(-90 38 38)"
          />
        )}
        <text x="38" y="43" textAnchor="middle">
          {ratePercent(rate)}
        </text>
      </svg>
      <figcaption>
        <b>{label}</b>
        <span>{detail}</span>
      </figcaption>
    </figure>
  );
}
