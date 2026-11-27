import { z } from 'zod';
import { ARTIFACT_SHARE_UPLOAD_KEY_PATTERN } from './artifact-shares.ts';

export const CLOUDFLARE_DEPLOY_URL =
  'https://deploy.workers.cloudflare.com/?url=https://github.com/karki011/spark-outpost/tree/main/infra/share-worker';

export const CLOUDFLARE_PROBLEMS = {
  address:
    'Use the https address of your share service alone, with no path, like https://spark-outpost-share.example.workers.dev.',
  key: 'That is not an upload key. Paste the key you set when you deployed the share service.',
  unreachable: 'Spark could not reach that address. Check it and try again.',
  notService: 'That address did not answer as a Spark share service.',
  refused: 'The share service refused that upload key.',
  open: 'That share service has no upload key, so anyone could add pages to it. Set one and try again.',
} as const;
export type CloudflareProblem = keyof typeof CLOUDFLARE_PROBLEMS;

export const cloudflareConnectionSchema = z.object({
  connected: z.boolean(),
  origin: z.string().nullable(),
  host: z.string().nullable(),
  shareArtifacts: z.boolean(),
  checkedAt: z.string().nullable(),
  problem: z.string().nullable(),
  sharedNow: z.number().int().min(0),
  deployUrl: z.string(),
});
export type CloudflareConnection = z.infer<typeof cloudflareConnectionSchema>;

export const connectCloudflareRequestSchema = z.object({
  address: z.string().trim().min(1).max(300),
  uploadKey: z.string().trim().regex(ARTIFACT_SHARE_UPLOAD_KEY_PATTERN),
});
export type ConnectCloudflareRequest = z.infer<typeof connectCloudflareRequestSchema>;

export const updateCloudflareRequestSchema = z.object({ shareArtifacts: z.boolean() });
export type UpdateCloudflareRequest = z.infer<typeof updateCloudflareRequestSchema>;

export const CLOUDFLARE_SHARE_PERMISSIONS = ['account', 'storage', 'workers'] as const;
export type CloudflareSharePermission = (typeof CLOUDFLARE_SHARE_PERMISSIONS)[number];

export const CLOUDFLARE_SETUP_STEPS = ['signIn', 'bucket', 'worker', 'connect'] as const;
export type CloudflareSetupStepId = (typeof CLOUDFLARE_SETUP_STEPS)[number];

export const cloudflareSetupStepSchema = z.object({
  id: z.enum(CLOUDFLARE_SETUP_STEPS),
  state: z.enum(['todo', 'working', 'done', 'failed']),
  problem: z.string().nullable(),
  fix: z.enum(['allow', 'retry', 'cloudflare']).nullable(),
  fixUrl: z.string().nullable(),
});
export type CloudflareSetupStep = z.infer<typeof cloudflareSetupStepSchema>;

export const cloudflareSetupSchema = z.object({
  available: z.boolean(),
  status: z.enum(['idle', 'waiting', 'working', 'stopped', 'done']),
  authorizeUrl: z.string().nullable(),
  account: z.string().nullable(),
  signedIn: z.boolean(),
  permissions: z.array(
    z.object({
      id: z.enum(CLOUDFLARE_SHARE_PERMISSIONS),
      state: z.enum(['needed', 'allowed', 'missing']),
    }),
  ),
  steps: z.array(cloudflareSetupStepSchema),
});
export type CloudflareSetup = z.infer<typeof cloudflareSetupSchema>;
