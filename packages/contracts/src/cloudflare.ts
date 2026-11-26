import { z } from 'zod';
import { ARTIFACT_SHARE_UPLOAD_KEY_PATTERN } from './artifact-shares.ts';

export const CLOUDFLARE_DEPLOY_URL =
  'https://deploy.workers.cloudflare.com/?url=https://github.com/karki011/spark-outpost/tree/main/infra/share-worker';

export const CLOUDFLARE_PROBLEMS = {
  address:
    'Use the https address of your share service alone, with no path, like https://spark-share.example.workers.dev.',
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
