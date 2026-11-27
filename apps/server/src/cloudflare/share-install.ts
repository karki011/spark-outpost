import { randomBytes } from 'node:crypto';
import type { WorkerUpload } from './account-api.ts';

export const SHARE_WORKER_NAME = 'spark-outpost-share';
export const SHARE_BUCKET_NAME = 'spark-outpost-shares';
export const SHARE_WORKER_CRON = '17 3 * * *';

export interface ShareKeys {
  uploadKey: string;
  signingKey: string;
}

export function newShareKeys(): ShareKeys {
  return {
    uploadKey: randomBytes(32).toString('base64url'),
    signingKey: randomBytes(48).toString('base64url'),
  };
}

export function shareWorkerUpload(module: string, keys: ShareKeys): WorkerUpload {
  return {
    name: SHARE_WORKER_NAME,
    moduleName: 'worker.mjs',
    module,
    metadata: shareWorkerMetadata(keys),
  };
}

function shareWorkerMetadata(keys: ShareKeys): Record<string, unknown> {
  return {
    compatibility_date: '2026-09-01',
    bindings: [
      { type: 'r2_bucket', name: 'SHARES', bucket_name: SHARE_BUCKET_NAME },
      { type: 'durable_object_namespace', name: 'COUNTERS', class_name: 'ShareCounters' },
      { type: 'analytics_engine', name: 'EVENTS', dataset: 'spark_outpost_share_events' },
      { type: 'secret_text', name: 'UPLOAD_KEY', text: keys.uploadKey },
      { type: 'secret_text', name: 'SIGNING_KEY', text: keys.signingKey },
    ],
    migrations: { new_tag: 'v1', new_sqlite_classes: ['ShareCounters'] },
    observability: { enabled: false },
  };
}

export const shareWorkerOrigin = (subdomain: string) =>
  `https://${SHARE_WORKER_NAME}.${subdomain}.workers.dev`;
