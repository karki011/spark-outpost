import * as acp from '@agentclientprotocol/sdk/unstable';
import { z } from 'zod';
import { accountKindSchema, type ProviderAccount } from '@spark-outpost/contracts';
import { ProviderError } from '../../providers/provider.ts';
import { objectFields } from './object-fields.ts';

export const AUTH_STATUS_METHOD = '_auth/status_update';
export const STANDARD_AUTH_STATUS_METHOD = acp.methods.client.auth.statusUpdate;

const LABEL_MAX = 120;
const PLAN_MAX = 60;
const SIGNED_OUT: ProviderAccount = { kind: 'none', label: 'Not logged in', plan: null };

const authStatusSchema = z.object({
  authStatus: z.object({
    kind: accountKindSchema,
    label: z.string(),
    account: z.object({ plan: z.string().optional() }).optional(),
  }),
});

const standardStatusSchema = z.object({
  state: z.string(),
  accounts: z
    .array(
      z.object({
        label: z.string(),
        active: z.boolean().nullish(),
        _meta: z.record(z.string(), z.unknown()).nullish(),
      }),
    )
    .nullish(),
});

function account(kind: ProviderAccount['kind'], label: string, plan: unknown): ProviderAccount {
  return {
    kind,
    label: label.slice(0, LABEL_MAX),
    plan: typeof plan === 'string' ? plan.slice(0, PLAN_MAX) : null,
  };
}

export function parseAuthStatus(params: unknown): ProviderAccount | null {
  const parsed = authStatusSchema.safeParse(params);
  if (!parsed.success) return null;
  const { kind, label, account: held } = parsed.data.authStatus;
  return account(kind, label, held?.plan);
}

export function parseStandardAuthStatus(params: unknown): ProviderAccount | null {
  const parsed = standardStatusSchema.safeParse(params);
  if (!parsed.success) return null;
  const { state, accounts } = parsed.data;
  if (state === 'unauthenticated') return SIGNED_OUT;
  if (state !== 'authenticated') return null;
  const active = accounts?.find((entry) => entry.active) ?? accounts?.[0];
  if (!active) return null;
  const claudeCode = objectFields(objectFields(active._meta).claudeCode);
  const kind = accountKindSchema.safeParse(claudeCode.kind);
  return kind.success ? account(kind.data, active.label, claudeCode.plan) : null;
}

export function advertisesAuthStatus(init: acp.InitializeResponse): boolean {
  const status = init.agentCapabilities?.auth?.status;
  return status !== undefined && status !== null;
}

export function signedOutError(agentName: string): ProviderError {
  return new ProviderError(
    `${agentName} isn't signed in. Open Settings, reconnect ${agentName}, and try again.`,
  );
}

export async function assertSignedIn(
  ctx: Pick<acp.ClientContext, 'request'>,
  init: acp.InitializeResponse,
  agentName: string,
): Promise<void> {
  if (!advertisesAuthStatus(init)) return;
  const status = await ctx.request(acp.methods.agent.auth.status, {}).catch(() => null);
  if (objectFields(status).state === 'unauthenticated') throw signedOutError(agentName);
}
