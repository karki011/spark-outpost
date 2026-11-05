import { z } from 'zod';
import { accountKindSchema, type ProviderAccount } from '@spark-outpost/contracts';

export const AUTH_STATUS_METHOD = '_auth/status_update';

const LABEL_MAX = 120;
const PLAN_MAX = 60;

const authStatusSchema = z.object({
  authStatus: z.object({
    kind: accountKindSchema,
    label: z.string(),
    account: z.object({ plan: z.string().optional() }).optional(),
  }),
});

export function parseAuthStatus(params: unknown): ProviderAccount | null {
  const parsed = authStatusSchema.safeParse(params);
  if (!parsed.success) return null;
  const { kind, label, account } = parsed.data.authStatus;
  return {
    kind,
    label: label.slice(0, LABEL_MAX),
    plan: account?.plan?.slice(0, PLAN_MAX) ?? null,
  };
}
