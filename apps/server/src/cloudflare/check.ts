import {
  ARTIFACT_SHARE_SERVICE_PATH,
  shareServiceInfoSchema,
  type CloudflareProblem,
} from '@spark-outpost/contracts';

export const CLOUDFLARE_CHECK_TIMEOUT_MS = 10_000;

export interface ServiceCheck {
  fetch: typeof fetch;
  timeoutMs: number;
}

export type ServiceCheckResult =
  { problem: CloudflareProblem } | { problem: null; maxDays: number };

export async function checkShareService(
  check: ServiceCheck,
  origin: string,
  uploadKey: string,
): Promise<ServiceCheckResult> {
  let response: Response;
  try {
    response = await check.fetch(`${origin}${ARTIFACT_SHARE_SERVICE_PATH}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${uploadKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(check.timeoutMs),
    });
  } catch {
    return { problem: 'unreachable' };
  }
  if (response.status === 401) {
    await response.body?.cancel().catch(() => undefined);
    return { problem: 'refused' };
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    return { problem: 'notService' };
  }
  const info = shareServiceInfoSchema.safeParse(await response.json().catch(() => null));
  if (!info.success) return { problem: 'notService' };
  if (info.data.uploadKey === 'none') return { problem: 'open' };
  return { problem: null, maxDays: info.data.maxDays };
}
