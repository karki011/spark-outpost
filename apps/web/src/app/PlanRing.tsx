import { useId } from 'react';
import { providerName } from '@spark-outpost/contracts';
import { tipText, useTooltip, type RichTip } from '../ui/Tooltip.tsx';
import { asOfText, mostUsed, NEAR_LIMIT, planItems, usePlanUsage } from '../usage/plan-usage.ts';
import './plan-ring.css';

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Ring({ percent, full }: { percent: number; full: boolean }) {
  const filled = (CIRCUMFERENCE * percent) / 100;
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true" className="plan-ring-svg">
      <circle className="plan-ring-track" cx={10} cy={10} r={RADIUS} />
      <circle
        className={full ? 'plan-ring-fill full' : 'plan-ring-fill'}
        cx={10}
        cy={10}
        r={RADIUS}
        strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}

export function PlanRing() {
  const { plans, now } = usePlanUsage();
  const plan = plans[0] ?? null;
  const tip: RichTip = plan
    ? {
        lead: `${providerName(plan.provider)} plan`,
        items: planItems(plan, now),
        footer: asOfText(plan),
      }
    : { items: [] };
  const { triggerProps, tooltip, show } = useTooltip(tip, { side: 'top' });
  const textId = useId();
  if (!plan) return null;
  const percent = mostUsed(plan);
  const full = percent >= NEAR_LIMIT || plan.windows.some((window) => window.limited);
  return (
    <>
      <button
        type="button"
        className="rail-btn plan-ring"
        aria-label={`${providerName(plan.provider)} plan limits`}
        {...triggerProps}
        aria-describedby={textId}
        onClick={(event) => show(event.currentTarget)}
      >
        <Ring percent={percent} full={full} />
        {percent}%
      </button>
      <span id={textId} hidden>
        {tipText(tip)}
      </span>
      {tooltip}
    </>
  );
}
