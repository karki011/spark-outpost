import type { SessionUpdate } from '@agentclientprotocol/sdk/unstable';
import { z } from 'zod';
import { limitStatusSchema, PLAN_WINDOWS, type PlanWindowId } from '@spark-outpost/contracts';
import type {
  ExtraUsageReading,
  PlanReading,
  PlanReport,
  ProviderOutput,
} from '../../providers/provider.ts';
import { objectFields } from './object-fields.ts';
import { reportedModel } from './long-context.ts';

export const RATE_LIMIT_META = '_claude/rateLimit';

const REASON_MAX = 60;
const fraction = z.number().finite().nonnegative();
const epochSeconds = z.number().finite().positive();

const windowSchema = z.object({
  utilization: fraction.optional(),
  resetsAt: epochSeconds.optional(),
});

const rateLimitSchema = z.object({
  status: limitStatusSchema,
  resetsAt: epochSeconds.optional(),
  rateLimitType: z.string().optional(),
  utilization: fraction.optional(),
  unifiedWindows: z.record(z.string(), z.unknown()).optional(),
  overageStatus: limitStatusSchema.optional(),
  overageResetsAt: epochSeconds.optional(),
  overageDisabledReason: z.string().optional(),
  limitScope: z.string().optional(),
  isUsingOverage: z.boolean().optional(),
  overageInUse: z.boolean().optional(),
});
type RateLimit = z.infer<typeof rateLimitSchema>;

const shortText = (text: string | undefined) => (text && text.length <= REASON_MAX ? text : null);

const toDate = (seconds: number) => new Date(seconds * 1000);

function unifiedWindow(info: RateLimit, window: PlanWindowId) {
  const parsed = windowSchema.safeParse(info.unifiedWindows?.[window]);
  return parsed.success ? parsed.data : null;
}

function reading(info: RateLimit, window: PlanWindowId): PlanReading | null {
  const named = info.rateLimitType === window;
  const limited = named && info.status === 'rejected';
  const unified = unifiedWindow(info, window);
  const used =
    unified?.utilization ?? (named ? info.utilization : undefined) ?? (limited ? 1 : undefined);
  const resetsAt = unified?.resetsAt ?? (named ? info.resetsAt : undefined);
  if (used === undefined || resetsAt === undefined) return null;
  return { window, used, resetsAt: toDate(resetsAt), limited };
}

function extraUsage(info: RateLimit): ExtraUsageReading | null {
  if (!info.overageStatus) return null;
  return {
    status: info.overageStatus,
    inUse: info.isUsingOverage === true || info.overageInUse === true,
    disabledReason: shortText(info.overageDisabledReason),
    limitScope: shortText(info.limitScope),
    resetsAt: info.overageResetsAt === undefined ? null : toDate(info.overageResetsAt),
  };
}

export function planReport(meta: unknown): PlanReport | null {
  const parsed = rateLimitSchema.safeParse(objectFields(meta)[RATE_LIMIT_META]);
  if (!parsed.success) return null;
  const windows = PLAN_WINDOWS.map((window) => reading(parsed.data, window)).filter(
    (found): found is PlanReading => found !== null,
  );
  const extra = extraUsage(parsed.data);
  if (windows.length === 0 && !extra) return null;
  return { windows, extraUsage: extra };
}

export function planOutputs(meta: unknown): ProviderOutput[] {
  const report = planReport(meta);
  return report ? [{ kind: 'plan_limits', ...report }] : [];
}

type UsageUpdate = Extract<SessionUpdate, { sessionUpdate: 'usage_update' }>;

export function usageOutputs(update: UsageUpdate): ProviderOutput[] {
  const model = reportedModel(update._meta);
  const usage: ProviderOutput = {
    kind: 'usage',
    contextUsed: update.used,
    contextSize: update.size,
    costUsd: update.cost?.currency === 'USD' ? update.cost.amount : null,
    ...(model ? { model } : {}),
  };
  return [usage, ...planOutputs(update._meta)];
}
