import { z } from 'zod';
import { providerIdSchema } from './provider-ids.ts';

export const PLAN_WINDOWS = [
  'five_hour',
  'seven_day',
  'seven_day_opus',
  'seven_day_sonnet',
  'seven_day_overage_included',
] as const;
export const planWindowIdSchema = z.enum(PLAN_WINDOWS);
export type PlanWindowId = z.infer<typeof planWindowIdSchema>;

export const LIMIT_STATUSES = ['allowed', 'allowed_warning', 'rejected'] as const;
export const limitStatusSchema = z.enum(LIMIT_STATUSES);
export type LimitStatus = z.infer<typeof limitStatusSchema>;

export const planWindowSchema = z.object({
  window: planWindowIdSchema,
  usedPercent: z.number().nonnegative(),
  resetsAt: z.string(),
  limited: z.boolean(),
  observedAt: z.string(),
});
export type PlanWindow = z.infer<typeof planWindowSchema>;

export const extraUsageSchema = z.object({
  status: limitStatusSchema,
  inUse: z.boolean(),
  disabledReason: z.string().max(60).nullable(),
  resetsAt: z.string().nullable(),
  observedAt: z.string(),
});
export type ExtraUsage = z.infer<typeof extraUsageSchema>;

export const planUsageSchema = z.object({
  provider: providerIdSchema,
  windows: z.array(planWindowSchema),
  extraUsage: extraUsageSchema.nullable(),
});
export type PlanUsage = z.infer<typeof planUsageSchema>;

export const planUsageListSchema = z.object({ plans: z.array(planUsageSchema) });
export type PlanUsageList = z.infer<typeof planUsageListSchema>;

const WINDOW_NAMES: Record<PlanWindowId, string> = {
  five_hour: '5-hour',
  seven_day: 'Week',
  seven_day_opus: 'Week · Opus',
  seven_day_sonnet: 'Week · Sonnet',
  seven_day_overage_included: 'Week · per model',
};

const LIMIT_NAMES: Record<PlanWindowId, string> = {
  five_hour: '5-hour limit',
  seven_day: 'weekly limit',
  seven_day_opus: 'weekly Opus limit',
  seven_day_sonnet: 'weekly Sonnet limit',
  seven_day_overage_included: 'weekly per-model limit',
};

export function planWindowName(window: PlanWindowId): string {
  return WINDOW_NAMES[window];
}

export function planLimitName(window: PlanWindowId): string {
  return LIMIT_NAMES[window];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

function clock(at: Date): string {
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return time.replace(/\b([AP])\.?M\.?$/i, (_match, half: string) => `${half.toLowerCase()}m`);
}

export function resetTimeText(resetsAt: Date, now: Date): string {
  const day = resetsAt.toLocaleDateString([], { weekday: 'short' });
  if (sameDay(resetsAt, now)) return clock(resetsAt);
  if (resetsAt.getTime() - now.getTime() < DAY_MS) return `${day} ${clock(resetsAt)}`;
  return day;
}

export function resetPhrase(resetsAt: Date, now: Date): string {
  const day = resetsAt.toLocaleDateString([], { weekday: 'long' });
  if (sameDay(resetsAt, now)) return `at ${clock(resetsAt)}`;
  return `on ${day} at ${clock(resetsAt)}`;
}

export function shownPercent(usedPercent: number): number {
  return Math.min(100, Math.round(usedPercent));
}

export function windowDetail(window: PlanWindow, now: Date): string {
  const reset = resetTimeText(new Date(window.resetsAt), now);
  return `${shownPercent(window.usedPercent)}% · resets ${reset}`;
}

const DISABLED_REASONS: Record<string, string> = {
  out_of_credits: 'out of credits',
  overage_not_provisioned: 'not set up',
  org_level_disabled: 'turned off by your organization',
  org_service_level_disabled: 'turned off by your organization',
  org_level_disabled_until: 'organization spend limit reached',
  member_level_disabled: 'turned off for your account',
  seat_tier_level_disabled: 'turned off for your seat',
};

export function extraUsageText(extra: ExtraUsage, now: Date): string {
  const state = extra.inUse ? 'in use' : extra.status === 'rejected' ? 'not available' : 'on';
  const reason =
    extra.status === 'rejected' && extra.disabledReason
      ? DISABLED_REASONS[extra.disabledReason]
      : undefined;
  const reset =
    extra.resetsAt && extra.status !== 'rejected'
      ? `resets ${resetTimeText(new Date(extra.resetsAt), now)}`
      : undefined;
  return [state, reason, reset].filter(Boolean).join(' · ');
}
