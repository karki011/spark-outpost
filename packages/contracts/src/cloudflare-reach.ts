import { z } from 'zod';
import { remoteHostnameSchema } from './remote.ts';

export const CLOUDFLARE_REACH_PERMISSIONS = [
  'account',
  'domains',
  'dns',
  'tunnel',
  'access',
] as const;
export type CloudflareReachPermission = (typeof CLOUDFLARE_REACH_PERMISSIONS)[number];

export const CLOUDFLARE_REACH_STEPS = [
  'signIn',
  'domain',
  'tunnel',
  'address',
  'signInPage',
  'start',
] as const;
export type CloudflareReachStepId = (typeof CLOUDFLARE_REACH_STEPS)[number];

export const cloudflareReachStepSchema = z.object({
  id: z.enum(CLOUDFLARE_REACH_STEPS),
  state: z.enum(['todo', 'working', 'done', 'failed']),
  problem: z.string().nullable(),
  fix: z.enum(['allow', 'retry', 'cloudflare']).nullable(),
  fixUrl: z.string().nullable(),
});
export type CloudflareReachStep = z.infer<typeof cloudflareReachStepSchema>;

export const cloudflareReachSchema = z.object({
  available: z.boolean(),
  status: z.enum(['idle', 'waiting', 'working', 'stopped', 'done']),
  authorizeUrl: z.string().nullable(),
  account: z.string().nullable(),
  signedIn: z.boolean(),
  hostname: z.string().nullable(),
  connected: z.string().nullable(),
  tunnel: z.enum(['off', 'starting', 'running', 'stopped']),
  permissions: z.array(
    z.object({
      id: z.enum(CLOUDFLARE_REACH_PERMISSIONS),
      state: z.enum(['needed', 'allowed', 'missing']),
    }),
  ),
  steps: z.array(cloudflareReachStepSchema),
});
export type CloudflareReach = z.infer<typeof cloudflareReachSchema>;

export const startCloudflareReachRequestSchema = z.object({
  hostname: remoteHostnameSchema,
  email: z.email().max(254),
});
export type StartCloudflareReachRequest = z.infer<typeof startCloudflareReachRequestSchema>;
