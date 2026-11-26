import { z } from 'zod';
import {
  cloudflareConnectionSchema,
  type CloudflareConnection,
  type ConnectCloudflareRequest,
  type UpdateCloudflareRequest,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const cloudflareKeys = { connection: ['cloudflare'] as const };

export const ARTIFACT_SHARE_KEY = ['artifact-share'] as const;

export const cloudflareApi = {
  connection: (): Promise<CloudflareConnection> =>
    request(cloudflareConnectionSchema, '/cloudflare'),
  connect: (body: ConnectCloudflareRequest): Promise<CloudflareConnection> =>
    request(cloudflareConnectionSchema, '/cloudflare', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  update: (body: UpdateCloudflareRequest): Promise<CloudflareConnection> =>
    request(cloudflareConnectionSchema, '/cloudflare', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  check: (): Promise<CloudflareConnection> =>
    request(cloudflareConnectionSchema, '/cloudflare/check', { method: 'POST', body: '{}' }),
  disconnect: (): Promise<null> => request(z.null(), '/cloudflare', { method: 'DELETE' }),
};
