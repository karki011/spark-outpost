import { randomBytes } from 'node:crypto';
import type { WorkerUpload } from './account-api.ts';

export const SHARE_WORKER_NAME = 'spark-outpost-artifact-share';
export const SHARE_BUCKET_NAME = 'spark-outpost-artifact-shares';
export const SHARE_WORKER_CRON = '17 3 * * *';
export const SHARE_COPIES_MAX = 20;

export interface ShareNames {
  worker: string;
  bucket: string;
}

export function shareNames(copy: number): ShareNames {
  const suffix = copy === 1 ? '' : `-${copy}`;
  return { worker: `${SHARE_WORKER_NAME}${suffix}`, bucket: `${SHARE_BUCKET_NAME}${suffix}` };
}

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

export function shareWorkerUpload(
  module: string,
  keys: ShareKeys,
  names: ShareNames,
): WorkerUpload {
  return {
    name: names.worker,
    moduleName: 'worker.mjs',
    module,
    metadata: shareWorkerMetadata(keys, names.bucket),
  };
}

function shareWorkerMetadata(keys: ShareKeys, bucket: string): Record<string, unknown> {
  return {
    compatibility_date: '2026-09-01',
    bindings: [
      { type: 'r2_bucket', name: 'SHARES', bucket_name: bucket },
      { type: 'durable_object_namespace', name: 'COUNTERS', class_name: 'ShareCounters' },
      { type: 'analytics_engine', name: 'EVENTS', dataset: 'spark_outpost_share_events' },
      { type: 'secret_text', name: 'UPLOAD_KEY', text: keys.uploadKey },
      { type: 'secret_text', name: 'SIGNING_KEY', text: keys.signingKey },
    ],
    migrations: { new_tag: 'v1', new_sqlite_classes: ['ShareCounters'] },
    observability: { enabled: false },
  };
}

export const shareWorkerOrigin = (worker: string, subdomain: string) =>
  `https://${worker}.${subdomain}.workers.dev`;
