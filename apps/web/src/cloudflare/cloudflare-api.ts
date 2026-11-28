import { z } from 'zod';
import {
  cloudflareConnectionSchema,
  cloudflareSetupSchema,
  type CloudflareConnection,
  type CloudflareSetup,
  type ConnectCloudflareRequest,
  type UpdateCloudflareRequest,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const cloudflareKeys = {
  connection: ['cloudflare'] as const,
  setup: ['cloudflare-setup'] as const,
  madeKeys: ['cloudflare-made-keys'] as const,
};

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
  setup: (): Promise<CloudflareSetup> => request(cloudflareSetupSchema, '/cloudflare/setup'),
  startSetup: (): Promise<CloudflareSetup> =>
    request(cloudflareSetupSchema, '/cloudflare/setup', { method: 'POST', body: '{}' }),
  cancelSetup: (): Promise<CloudflareSetup> =>
    request(cloudflareSetupSchema, '/cloudflare/setup', { method: 'DELETE' }),
  disconnect: (): Promise<null> => request(z.null(), '/cloudflare', { method: 'DELETE' }),
};
