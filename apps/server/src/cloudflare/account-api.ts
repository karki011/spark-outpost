import { z } from 'zod';

const REQUEST_TIMEOUT_MS = 30_000;
const MESSAGE_LIMIT = 200;

const BUCKET_EXISTS = 10004;
const R2_NOT_ENABLED = 10042;
const NOT_FOUND = 10007;

export interface CloudflareAccountApi {
  fetch: typeof fetch;
  apiUrl: string;
  token: string;
}

export type CloudflareApiFailure = 'unreachable' | 'permission' | 'r2Off' | 'notFound' | 'refused';

export class CloudflareApiError extends Error {
  readonly kind: CloudflareApiFailure;

  constructor(kind: CloudflareApiFailure, message: string) {
    super(message);
    this.kind = kind;
  }
}

const envelopeSchema = z.object({
  success: z.boolean(),
  errors: z
    .array(z.object({ code: z.number().optional(), message: z.string().optional() }))
    .nullish(),
  result: z.unknown().optional(),
});

function failureOf(status: number, codes: number[]): CloudflareApiFailure {
  if (codes.includes(R2_NOT_ENABLED)) return 'r2Off';
  if (status === 404 || codes.includes(NOT_FOUND)) return 'notFound';
  if (status === 401 || status === 403) return 'permission';
  return 'refused';
}

async function call(
  api: CloudflareAccountApi,
  method: string,
  path: string,
  body?: { json: unknown } | { form: FormData },
  accept: number[] = [],
): Promise<unknown> {
  let response: Response;
  try {
    response = await api.fetch(`${api.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${api.token}`,
        ...(body && 'json' in body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: 'json' in body ? JSON.stringify(body.json) : body.form } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new CloudflareApiError('unreachable', 'Spark couldn’t reach Cloudflare.');
  }
  const parsed = envelopeSchema.safeParse(await response.json().catch(() => null));
  if (response.ok && parsed.success && parsed.data.success) return parsed.data.result;
  const errors = parsed.success ? (parsed.data.errors ?? []) : [];
  const codes = errors.flatMap((error) => (error.code === undefined ? [] : [error.code]));
  if (codes.some((code) => accept.includes(code))) return null;
  const said = errors.find((error) => error.message)?.message ?? `HTTP ${response.status}`;
  throw new CloudflareApiError(failureOf(response.status, codes), said.slice(0, MESSAGE_LIMIT));
}

const accountsSchema = z
  .array(z.object({ id: z.string().min(1).max(64), name: z.string() }))
  .min(1);

export interface CloudflareAccount {
  id: string;
  name: string;
}

export async function firstAccount(api: CloudflareAccountApi): Promise<CloudflareAccount> {
  const accounts = accountsSchema.safeParse(await call(api, 'GET', '/accounts'));
  if (!accounts.success) {
    throw new CloudflareApiError('refused', 'Cloudflare listed no account for this sign-in.');
  }
  return accounts.data[0]!;
}

const account = (id: string) => `/accounts/${encodeURIComponent(id)}`;
const script = (id: string, name: string) =>
  `${account(id)}/workers/scripts/${encodeURIComponent(name)}`;

const subdomainSchema = z.object({ subdomain: z.string().regex(/^[a-z0-9-]{1,63}$/) });

export async function workersSubdomain(
  api: CloudflareAccountApi,
  accountId: string,
): Promise<string | null> {
  try {
    const result = await call(api, 'GET', `${account(accountId)}/workers/subdomain`);
    const parsed = subdomainSchema.safeParse(result);
    return parsed.success ? parsed.data.subdomain : null;
  } catch (error) {
    if (error instanceof CloudflareApiError && error.kind === 'notFound') return null;
    throw error;
  }
}

export async function createBucket(
  api: CloudflareAccountApi,
  accountId: string,
  name: string,
): Promise<void> {
  await call(api, 'POST', `${account(accountId)}/r2/buckets`, { json: { name } }, [BUCKET_EXISTS]);
}

export async function scriptExists(
  api: CloudflareAccountApi,
  accountId: string,
  name: string,
): Promise<boolean> {
  try {
    await call(api, 'GET', `${script(accountId, name)}/settings`);
    return true;
  } catch (error) {
    if (error instanceof CloudflareApiError && error.kind === 'notFound') return false;
    throw error;
  }
}

export interface WorkerUpload {
  name: string;
  moduleName: string;
  module: string;
  metadata: Record<string, unknown>;
}

export async function uploadScript(
  api: CloudflareAccountApi,
  accountId: string,
  upload: WorkerUpload,
): Promise<void> {
  const form = new FormData();
  form.set(
    'metadata',
    new Blob([JSON.stringify({ ...upload.metadata, main_module: upload.moduleName })], {
      type: 'application/json',
    }),
  );
  form.set(
    upload.moduleName,
    new Blob([upload.module], { type: 'application/javascript+module' }),
    upload.moduleName,
  );
  await call(api, 'PUT', script(accountId, upload.name), { form });
}

export async function setSchedule(
  api: CloudflareAccountApi,
  accountId: string,
  name: string,
  cron: string,
): Promise<void> {
  await call(api, 'PUT', `${script(accountId, name)}/schedules`, { json: [{ cron }] });
}

export async function enableWorkersDev(
  api: CloudflareAccountApi,
  accountId: string,
  name: string,
): Promise<void> {
  await call(api, 'POST', `${script(accountId, name)}/subdomain`, {
    json: { enabled: true, previews_enabled: false },
  });
}
