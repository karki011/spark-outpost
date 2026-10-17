import {
  extraUsageText,
  planWindowName,
  providerName,
  resetTimeText,
  shownPercent,
  type PlanWindow,
} from '@spark-outpost/contracts';
import { asOfText, NEAR_LIMIT, usePlanUsage, type ShownPlan } from './plan-usage.ts';
import './plan-meter.css';

function WindowRow({ window, now }: { window: PlanWindow; now: Date }) {
  const percent = shownPercent(window.usedPercent);
  const name = planWindowName(window.window);
  const full = window.limited || percent >= NEAR_LIMIT;
  return (
    <li className={full ? 'pm-row full' : 'pm-row'}>
      <span className="pm-name">{name}</span>
      <span className="pm-used">{percent}% used</span>
      <span
        className="pm-bar"
        role="progressbar"
        aria-label={`${name} limit used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <i style={{ transform: `scaleX(${percent / 100})` }} />
      </span>
      <span className="pm-reset">resets {resetTimeText(new Date(window.resetsAt), now)}</span>
    </li>
  );
}

function PlanCard({ plan, now }: { plan: ShownPlan; now: Date }) {
  const name = providerName(plan.provider);
  return (
    <section className="plan-meter" aria-label={`${name} plan limits`}>
      <ul className="pm-rows">
        {plan.windows.map((window) => (
          <WindowRow key={window.window} window={window} now={now} />
        ))}
      </ul>
      {plan.extraUsage && (
        <p className="pm-extra">Extra usage: {extraUsageText(plan.extraUsage, now)}</p>
      )}
      <p className="pm-note">
        {name} plan. {asOfText(plan)}.
      </p>
    </section>
  );
}

export function PlanMeter({ providers }: { providers: readonly string[] }) {
  const { plans, now } = usePlanUsage(providers);
  if (plans.length === 0) return null;
  return (
    <div className="plan-meters">
      <h3 className="pm-h">Plan limits</h3>
      {plans.map((plan) => (
        <PlanCard key={plan.provider} plan={plan} now={now} />
      ))}
    </div>
  );
}
