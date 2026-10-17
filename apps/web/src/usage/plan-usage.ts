import { useQuery } from '@tanstack/react-query';
import {
  shortClock,
  extraUsageText,
  planWindowName,
  shownPercent,
  windowDetail,
  type ExtraUsage,
  type PlanUsage,
  type PlanWindow,
} from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { useMinuteClock } from '../ui/use-minute-clock.ts';

export const NEAR_LIMIT = 90;
export const RING_SHOWN_FROM_PERCENT = 70;

export interface ShownPlan {
  provider: PlanUsage['provider'];
  windows: PlanWindow[];
  extraUsage: ExtraUsage | null;
  asOf: Date;
}

function stillOpen(at: string | null, now: number): boolean {
  return at === null || Date.parse(at) > now;
}

export function shownPlan(plan: PlanUsage, now: number): ShownPlan | null {
  const windows = plan.windows.filter((window) => stillOpen(window.resetsAt, now));
  const extraUsage =
    plan.extraUsage && stillOpen(plan.extraUsage.resetsAt, now) ? plan.extraUsage : null;
  if (windows.length === 0 && !extraUsage) return null;
  const readings = [...windows, ...(extraUsage ? [extraUsage] : [])];
  const asOf = Math.max(...readings.map((reading) => Date.parse(reading.observedAt)));
  return { provider: plan.provider, windows, extraUsage, asOf: new Date(asOf) };
}

export function mostUsed(plan: ShownPlan): number {
  return Math.max(0, ...plan.windows.map((window) => shownPercent(window.usedPercent)));
}

export function planItems(plan: ShownPlan, now: Date): { label: string; text: string }[] {
  const items = plan.windows.map((window) => ({
    label: planWindowName(window.window),
    text: windowDetail(window, now),
  }));
  if (!plan.extraUsage) return items;
  return [...items, { label: 'Extra usage', text: extraUsageText(plan.extraUsage, now) }];
}

export function asOfText(plan: ShownPlan): string {
  return `As of the last reply at ${shortClock(plan.asOf)}`;
}

export function usePlanUsage(providers?: readonly string[]): { plans: ShownPlan[]; now: Date } {
  const now = useMinuteClock();
  const query = useQuery({ queryKey: queryKeys.planUsage, queryFn: api.getPlanUsage });
  const plans = (query.data?.plans ?? [])
    .filter((plan) => !providers || providers.includes(plan.provider))
    .map((plan) => shownPlan(plan, now))
    .filter((plan): plan is ShownPlan => plan !== null);
  return { plans, now: new Date(now) };
}
